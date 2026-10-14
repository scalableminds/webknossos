import contextlib
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('fixture_server.py'))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
ID = '000000000000000000000001'
KEY = 'test-secret-key'
TOKEN = 'test-secret-token'
ALT = 'test-alternate-token'


def catalog():
    return dict(version=1, datastore='replay-ds', organization='replay-org', datasets=[dict(datasetId=ID, rootPath='dataset', dataSource=dict(id=dict(name='tiny', team='replay-org'), dataLayers=[dict(name='color', mags=[dict(path='${FIXTURE_ROOT}/dataset')])]))], remoteFiles={'data.bin': dict(path='data.bin', requireToken=True)}, credentials={'replay-http': dict(_type='com.scalableminds.webknossos.datastore.storage.XAuthTokenCredential',name='fixture',tokenValue='${FIXTURE_TOKEN}')})


@contextlib.contextmanager
def fixture():
    with tempfile.TemporaryDirectory(prefix='wk-fixture-test-') as root:
        Path(root, 'dataset').mkdir()
        Path(root, 'data.bin').write_bytes(b'0123456789')
        state = f.FixtureState(root, catalog(), KEY, [TOKEN, ALT])
        server = f.make_server(state)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield state, root
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


def request(origin, path, method='GET', body=None, headers=None):
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(origin + path, data=payload, method=method, headers=headers or {})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = opener.open(req, timeout=3)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, dict(response.headers), response.read()


class FixtureServerTests(unittest.TestCase):
    def test_rpc_identity_auth_data_root_credential_and_unsupported(self):
        with fixture() as (state, root):
            prefix='/api/datastores/replay-ds/'
            access=dict(resourceType='dataset',mode='read',resourceId=ID)
            for token, granted in ((TOKEN, True), (ALT, True), ('cross-organization-token',False), ('',False)):
                status, _, body = request(state.origin,prefix+'validateUserAccess?key='+KEY+'&token='+token,'POST',access)
                self.assertEqual(status,200)
                self.assertEqual(json.loads(body)['granted'], granted)
            for changed in (dict(access, mode='write'), dict(access,resourceId='000000000000000000000002'),dict(access,resourceType='webknossos')):
                self.assertFalse(json.loads(request(state.origin,prefix+'validateUserAccess?key='+KEY+'&token='+TOKEN,'POST',changed)[2])['granted'])
            self.assertEqual(request(state.origin,prefix+'datasources/'+ID+'?key=wrong')[0],403)
            source=json.loads(request(state.origin,prefix+'datasources/'+ID+'?key='+KEY)[2])
            self.assertEqual(source['dataLayers'][0]['mags'][0]['path'],str(Path(root).resolve()/'dataset'))
            self.assertEqual(json.loads(request(state.origin,prefix+'findDatasetLocalRootPath?datasetId='+ID+'&key='+KEY)[2]),str(Path(root).resolve()/'dataset'))
            self.assertEqual(json.loads(request(state.origin,prefix+'findDatasetId?organizationId=replay-org&datasetDirectoryName=tiny&key='+KEY)[2]),ID)
            self.assertEqual(request(state.origin,prefix+'findDatasetId?organizationId=other&datasetDirectoryName=tiny&key='+KEY)[0],404)
            credential=json.loads(request(state.origin,prefix+'findCredential?credentialId=replay-http&key='+KEY)[2])
            self.assertEqual(credential['tokenValue'],TOKEN)
            self.assertEqual(request(state.origin,prefix+'findCredential?credentialId=missing&key='+KEY)[0],404)
            self.assertEqual(request(state.origin,prefix+'deleteDataset?key='+KEY,'POST',ID)[0],404)
            self.assertEqual(request(state.origin,'/api/tracingstore?key='+KEY)[0],404)
            self.assertEqual(request(state.origin,'/api/datastores/production/status?key='+KEY,'PATCH',{})[0],404)
            output=json.dumps(state.counters())
            for secret in (KEY,TOKEN,ALT,'cross-organization-token',root,ID):
                self.assertNotIn(secret,output)

    def test_range_full_head_suffix_invalid_and_token_after_cache(self):
        with fixture() as (state,_):
            path='/files/data.bin'
            status,headers,body=request(state.origin,path,'HEAD')
            self.assertEqual((status,body),(200,b''))
            self.assertEqual(headers['Content-Length'],'10')
            self.assertEqual(headers['Accept-Ranges'],'bytes')
            for token in (TOKEN,ALT):
                status,headers,body=request(state.origin,path,headers={'X-Auth-Token':token,'Range':'bytes=2-5'})
                self.assertEqual((status,body),(206,b'2345'))
                self.assertEqual(headers['Content-Range'],'bytes 2-5/10')
            self.assertEqual(request(state.origin,path,headers={'X-Auth-Token':'wrong','Range':'bytes=2-5'})[0],403)
            for header,body in (('bytes=-3',b'789'),('bytes=8-',b'89'),('bytes=8-99',b'89')):
                self.assertEqual(request(state.origin,path,headers={'X-Auth-Token':TOKEN,'Range':header})[2],body)
            for header in ('bytes=99-100','bytes=3-2','bytes=0-1,3-4','bytes=-0','bad'):
                self.assertEqual(request(state.origin,path,headers={'X-Auth-Token':TOKEN,'Range':header})[0],416)
            self.assertEqual(request(state.origin,path,headers={'X-Auth-Token':TOKEN})[2],b'0123456789')
            self.assertEqual(request(state.origin,'/files/../data.bin',headers={'X-Auth-Token':TOKEN})[0],404)
            counts=state.counters()
            self.assertEqual(counts['remote_alternate'],1)
            self.assertEqual(counts['remote_denied'],1)

    def test_scoped_reports_and_readiness(self):
        with fixture() as (state,_):
            self.assertTrue(json.loads(request(state.origin,'/health')[2])['ready'])
            prefix='/api/datastores/replay-ds/'
            self.assertEqual(request(state.origin,prefix+'status?key='+KEY,'PATCH',dict(ok=True,url='http://127.0.0.1:9090'))[0],200)
            self.assertEqual(request(state.origin,prefix+'status?key='+KEY,'PATCH',dict(ok=True,url='https://production.example'))[0],400)
            source=catalog()['datasets'][0]['dataSource']
            for action, payload in (('datasource',source),('datasources',[dict(dataSource=source,rootPath=None,rootRealPath=None)]),('datasources/realpaths',[dict(dataSourceId=source['id'],magPathInfos=[],attachmentPathInfos=[])])):
                self.assertEqual(request(state.origin,prefix+action+'?key='+KEY,'PUT',payload)[0],200)
            source['id']['team']='other-org'
            self.assertEqual(request(state.origin,prefix+'datasource?key='+KEY,'PUT',source)[0],400)
            self.assertIn('report_status',json.loads(request(state.origin,'/counters')[2]))

    def test_isolation_configuration(self):
        with fixture() as (_,root):
            for relative in ('../escape','/etc/passwd'):
                with self.assertRaises(f.InvalidFixture):f.inside(Path(root),relative)
            for change in (dict(organization='production'),dict(datastore='production')):
                with self.assertRaises(f.InvalidFixture):f.FixtureState(root,dict(catalog(),**change),KEY,[TOKEN])
            broken=catalog();broken['datasets'][0]['datasetId']='abcdef000000000000000001'
            with self.assertRaises(f.InvalidFixture):f.FixtureState(root,broken,KEY,[TOKEN])
            with self.assertRaises(f.InvalidFixture):f.FixtureState('/',catalog(),KEY,[TOKEN])
            outside=Path(root)/'escape';outside.symlink_to('/etc/passwd')
            with self.assertRaises(f.InvalidFixture):f.inside(Path(root),'escape')

    def test_cli_stdout_shutdown_no_secrets(self):
        with tempfile.TemporaryDirectory(prefix='wk-fixture-cli-') as root:
            Path(root,'dataset').mkdir();Path(root,'data.bin').write_bytes(b'abc')
            path=Path(root,'catalog.json');path.write_text(json.dumps(catalog()))
            env=dict(os.environ,WK_REPLAY_FIXTURE_KEY=KEY,WK_REPLAY_TOKEN=TOKEN)
            process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('fixture_server.py')),'--root',root,'--catalog',str(path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
            try:
                self.assertTrue(select.select([process.stdout],[],[],5)[0])
                first=process.stdout.readline();ready=json.loads(first)
                self.assertTrue(ready['ready'])
                self.assertEqual(request(ready['origin'],'/health')[0],200)
                process.terminate()
                out,err=process.communicate(timeout=5)
                self.assertEqual(process.returncode,0)
                self.assertTrue(json.loads(out)['stopped'])
                self.assertEqual(err,'')
                for secret in (KEY,TOKEN,root):self.assertNotIn(secret,first+out+err)
            finally:
                if process.poll() is None:
                    process.terminate();process.communicate(timeout=5)

if __name__ == '__main__':unittest.main()
