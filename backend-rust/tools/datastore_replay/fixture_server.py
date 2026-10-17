#!/usr/bin/env python3
"""Isolated loopback WEBKNOSSOS RPC/HTTP-range fixture server (no real backend)."""
import argparse
from collections import Counter
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import signal
import tempfile
import threading
import urllib.parse

class InvalidFixture(ValueError):
    pass


def inside(root, relative):
    if not isinstance(relative, str) or Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise InvalidFixture('fixture paths must be relative')
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise InvalidFixture('fixture path escapes root')
    return path


def expand(value, root, origin, token):
    if isinstance(value, str):
        return value.replace('${FIXTURE_ROOT}', str(root)).replace('${FIXTURE_ORIGIN}', origin).replace('${FIXTURE_TOKEN}', token)
    if isinstance(value, list):
        return [expand(v, root, origin, token) for v in value]
    if isinstance(value, dict):
        return {k: expand(v, root, origin, token) for k, v in value.items()}
    return value


class FixtureState:
    def __init__(self, root, catalog, key, tokens, second_key=None):
        self.root = Path(root).resolve(strict=True)
        temp_roots = {Path(tempfile.gettempdir()).resolve(), Path('/tmp').resolve()}
        if not self.root.is_dir() or not any(self.root != t and self.root.is_relative_to(t) for t in temp_roots):
            raise InvalidFixture('explicit fixture root must be a directory below temporary storage')
        if not key or not tokens or any(not t for t in tokens) or key in tokens:
            raise InvalidFixture('distinct nonempty key and token required')
        if second_key is not None and (not second_key or second_key == key or second_key in tokens):
            raise InvalidFixture('second datastore key must be distinct and nonempty')
        if catalog.get('version') != 1 or catalog.get('organization') != 'replay-org' or catalog.get('datastore') != 'replay-ds':
            raise InvalidFixture('only replay v1 organization/datastore identity supported')
        self.key = key
        # The upload phase gives each datastore its own key, so upload RPCs and their effects stay
        # per side (`scala` for the first key, `rust` for the second).
        self.keys = {'scala': key, **({'rust': second_key} if second_key else {})}
        self.uploads = {side: {'reserved': {}, 'calls': []} for side in self.keys}
        self.tokens = tokens
        self.catalog = catalog
        self.datasets = {}
        for dataset in catalog['datasets']:
            identifier = dataset['datasetId']
            source = dataset['dataSource']
            if not re.fullmatch(r'000000[0-9a-f]{18}', identifier) or identifier in self.datasets:
                raise InvalidFixture('dataset IDs must be unique test identifiers')
            sid = source['id']
            if sid.get('team', sid.get('organizationId')) != 'replay-org':
                raise InvalidFixture('dataset organization must be replay-org')
            inside(self.root, dataset['rootPath'])
            self.datasets[identifier] = dataset
        if not self.datasets:
            raise InvalidFixture('fixture datasets required')
        # Readable datasets whose datasource RPC fails with the given status (WK-side errors).
        self.broken = catalog.get('brokenDatasets', {})
        for identifier, status in self.broken.items():
            if not re.fullmatch(r'000000[0-9a-f]{18}', identifier) or identifier in self.datasets \
                    or type(status) is not int or not 400 <= status <= 599:
                raise InvalidFixture('broken datasets need unique test identifiers and an error status')
        self.files = {}
        for alias, entry in catalog.get('remoteFiles', {}).items():
            if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', alias) or '..' in alias:
                raise InvalidFixture('invalid remote alias')
            path = inside(self.root, entry['path'])
            if not path.is_file():
                raise InvalidFixture('remote fixture file missing')
            self.files[alias] = (path, entry.get('requireToken', True))
        self.credentials = catalog.get('credentials', {})
        for identifier, credential in self.credentials.items():
            if not re.fullmatch(r'replay-[A-Za-z0-9_.-]+', identifier) or credential.get('_type', '').split('.')[-1] != 'XAuthTokenCredential' or credential.get('tokenValue') != '${FIXTURE_TOKEN}':
                raise InvalidFixture('only test XAuthToken credential placeholders supported')
        self.counts = Counter()
        self.lock = threading.Lock()
        self.origin = ''

    def count(self, category):
        with self.lock:
            self.counts[category] += 1

    def counters(self):
        with self.lock:
            return dict(self.counts)

    def token_label(self, token):
        for index, expected in enumerate(self.tokens):
            if hmac.compare_digest(token, expected):
                return 'primary' if index == 0 else 'alternate'
        return 'denied'

    def side(self, key):
        for side, expected in self.keys.items():
            if hmac.compare_digest(key, expected):
                return side
        return None

    def record(self, side, action, query, body):
        with self.lock:
            self.uploads[side]['calls'].append({'action': action, 'query': query, 'body': body})

    def reserve(self, side, info):
        """WK `reserveDatasetUpload`: a deterministic id and directory name per dataset name."""
        name = info['datasetName']
        identifier = 'f00000' + hashlib.sha256(name.encode()).hexdigest()[:18]
        directory = re.sub(r'[^A-Za-z0-9_-]', '_', name)
        with self.lock:
            self.uploads[side]['reserved'][identifier] = {
                'uploadId': info['resumableUploadInfo']['uploadId'], 'name': name, 'directory': directory,
                'filePaths': info['resumableUploadInfo'].get('filePaths'), 'finished': False}
        return {'newDatasetId': identifier, 'directoryName': directory}

    def unfinished(self, side):
        with self.lock:
            return [{'uploadId': '', 'dataSourceId': {'name': r['directory'], 'team': 'replay-org'},
                     'datasetName': r['name'], 'folderId': '000000000000000000000001', 'created': 1760000000000,
                     'filePaths': r['filePaths'], 'allowedTeams': []}
                    for r in self.uploads[side]['reserved'].values() if not r['finished']]

    def upload_access(self, side, resource, mode, identifier):
        with self.lock:
            reserved = self.uploads[side]['reserved'] if side else {}
            return resource == 'dataset' and (
                (mode == 'administrate' and identifier == 'replay-org')
                or (mode in ('read', 'write', 'delete') and identifier in reserved))

    def data_source(self, identifier):
        return expand(self.datasets[identifier]['dataSource'], self.root, self.origin, self.tokens[0])


def make_server(state, port=0):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *args):
            pass  # Base logger emits URLs and query credentials.
        def reply(self, status, value=None, headers=None, raw=None):
            body = raw if raw is not None else json.dumps(value, separators=(',', ':')).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/octet-stream' if raw is not None else 'application/json')
            self.send_header('Content-Length', str(len(body)))
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)
        def body(self):
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > 2 * 1024 * 1024 or self.headers.get('Transfer-Encoding'):
                raise ValueError('invalid body limit')
            return json.loads(self.rfile.read(size))
        def dispatch(self):
            try:
                self.handle_fixture()
            except (ValueError, KeyError, TypeError, AttributeError, OSError):
                state.count('invalid_request')
                self.close_connection = True
                self.reply(400, {'error': 'invalid_fixture_request'})
        do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = dispatch
        def handle_fixture(self):
            split = urllib.parse.urlsplit(self.path)
            path = split.path
            query = urllib.parse.parse_qs(split.query, keep_blank_values=True)
            one = lambda key: query.get(key, [''])[0] if len(query.get(key, [''])) == 1 else ''
            if self.command == 'GET' and path == '/health':
                self.reply(200, {'ready': True})
                return
            if self.command == 'GET' and path == '/counters':
                self.reply(200, state.counters())
                return
            if self.command == 'GET' and path == '/upload-calls':
                # Recorded upload RPCs of one side (bodies only carry fixture identities).
                with state.lock:
                    self.reply(200, state.uploads.get(one('side'), {}).get('calls', []))
                return
            if path.startswith('/files/'):
                self.remote_file(path[len('/files/'):])
                return
            if path.startswith('/api/annotations/source/'):
                # No annotation private links exist: WK answers 404, or the status a probe token names.
                state.count('annotation_source')
                status = {'forbidden-link': 403, 'bad-link': 400}.get(path.rsplit('/', 1)[-1], 404)
                self.reply(status, {'messages': [{'error': 'Fixture annotation not found.'}]})
                return
            prefix = '/api/datastores/replay-ds/'
            if not path.startswith(prefix):
                state.count('unsupported_rpc')
                self.reply(404, {'error': 'unsupported_fixture_rpc'})
                return
            action = path[len(prefix):]
            side = state.side(one('key'))
            if side is None:
                state.count('key_denied')
                self.reply(403, {'error': 'fixture_key_denied'})
                return
            token_label = state.token_label(one('token'))
            if self.upload_rpc(action, side, token_label, one):
                return
            if self.command == 'POST' and action == 'validateUserAccess':
                request = self.body()
                identifier = request.get('resourceId')
                resource = request.get('resourceType')
                mode = request.get('mode')
                granted = token_label != 'denied' and (
                    resource == 'dataset' and mode == 'read' and (identifier in state.datasets or identifier in state.broken)
                    or state.upload_access(side, resource, mode, identifier))
                state.count('access_' + token_label + ('_granted' if granted else '_denied'))
                self.reply(200, {'granted': granted, **({} if granted else {'msg': 'Fixture access denied.'})})
                return
            if self.command == 'GET' and action.startswith('datasources/'):
                identifier = action[len('datasources/'):]
                state.count('datasource')
                if identifier in state.broken:
                    self.reply(state.broken[identifier], {'messages': [{'error': 'Fixture data source unavailable.'}]})
                elif identifier not in state.datasets:
                    self.reply(404, {'error': 'fixture_dataset_missing'})
                else:
                    self.reply(200, state.data_source(identifier))
                return
            if self.command == 'GET' and action == 'findDatasetLocalRootPath':
                identifier = one('datasetId')
                state.count('rootpath')
                if identifier not in state.datasets:
                    self.reply(404, {'error': 'fixture_dataset_missing'})
                else:
                    self.reply(200, str(inside(state.root, state.datasets[identifier]['rootPath'])))
                return
            if self.command == 'GET' and action == 'findDatasetId':
                found = [identifier for identifier, d in state.datasets.items() if one('organizationId') == 'replay-org' and d['dataSource']['id'].get('name', d['dataSource']['id'].get('directoryName')) == one('datasetDirectoryName')]
                state.count('dataset_lookup')
                self.reply(200 if len(found) == 1 else 404, found[0] if len(found) == 1 else {'error': 'fixture_dataset_missing'})
                return
            if self.command == 'GET' and action == 'findCredential':
                credential = state.credentials.get(one('credentialId'))
                state.count('credential')
                self.reply(200 if credential else 404, expand(credential, state.root, state.origin, state.tokens[0]) if credential else {'error': 'fixture_credential_missing'})
                return
            if self.command == 'PATCH' and action == 'status':
                payload = self.body()
                uri = urllib.parse.urlsplit(payload['url'])
                if type(payload['ok']) is not bool or uri.hostname not in ('127.0.0.1', 'localhost', '::1'):
                    raise ValueError('invalid status')
                state.count('report_status')
                self.reply(200, {})
                return
            if self.command == 'PUT' and action in ('datasource', 'datasources', 'datasources/realpaths'):
                payload = self.body()
                sources = [payload] if action == 'datasource' else payload
                if not isinstance(sources, list) or one('organizationId') not in ('', 'replay-org'):
                    raise ValueError('invalid report')
                for source in sources:
                    sid = source.get('dataSourceId') if action == 'datasources/realpaths' else (source.get('dataSource', source)).get('id')
                    if not isinstance(sid, dict) or sid.get('team', sid.get('organizationId')) != 'replay-org':
                        raise ValueError('invalid report identity')
                state.count('report_' + action.replace('/', '_'))
                self.reply(200, {})
                return
            state.count('unsupported_rpc')
            self.reply(404, {'error': 'unsupported_fixture_rpc'})
        def upload_rpc(self, action, side, token_label, one):
            """Dataset upload RPCs (DC1e); every call is recorded per side for the comparison."""
            if self.command == 'POST' and action == 'reserveDatasetUpload':
                info = self.body()
                state.record(side, action, {}, info)
                if token_label == 'denied':
                    self.reply(403, {'messages': [{'error': 'Fixture access denied.'}]})
                else:
                    self.reply(200, state.reserve(side, info))
            elif self.command == 'POST' and action == 'reportDatasetUpload':
                body = self.body()
                state.record(side, action, {'datasetId': one('datasetId')}, body)
                with state.lock:
                    reserved = state.uploads[side]['reserved'].get(one('datasetId'))
                    if reserved:
                        reserved['finished'] = True
                self.reply(200 if reserved else 404, {} if reserved else {'error': 'fixture_upload_missing'})
            elif self.command == 'POST' and action == 'deleteDataset':
                body = self.body()
                state.record(side, action, {}, body)
                with state.lock:
                    removed = state.uploads[side]['reserved'].pop(body, None) if isinstance(body, str) else None
                # Only datasets this side reserved can be deleted; catalog datasets never.
                self.reply(200 if removed else 404, {} if removed else {'error': 'fixture_upload_missing'})
            elif self.command == 'POST' and action in ('reserveMagUpload', 'reserveAttachmentUpload'):
                # WK answers with the target dataset's id; only datasets this side uploaded exist.
                info = self.body()
                state.record(side, action, {}, info)
                with state.lock:
                    reserved = state.uploads[side]['reserved'].get(info.get('datasetId'))
                if token_label == 'denied':
                    self.reply(403, {'messages': [{'error': 'Fixture access denied.'}]})
                elif not reserved or info.get('layerName') != 'color':
                    self.reply(400, {'messages': [{'error': 'Fixture dataset or layer not found.'}]})
                else:
                    self.reply(200, {'dataSourceId': {'name': reserved['directory'], 'team': 'replay-org'}})
            elif self.command == 'POST' and action in ('reportMagUpload', 'reportAttachmentUpload'):
                state.record(side, action, {}, self.body())
                self.reply(200, {})
            elif self.command == 'GET' and action == 'getUnfinishedDatasetUploadsForUser':
                state.record(side, action, {'organizationName': one('organizationName')}, None)
                self.reply(200, state.unfinished(side))
            else:
                return False
            state.count('upload_' + action)
            return True
        def remote_file(self, alias):
            state.count('remote_request')
            if self.command not in ('GET', 'HEAD') or alias not in state.files:
                self.reply(404, {'error': 'fixture_file_missing'})
                return
            file, required = state.files[alias]
            # Scala probes range/length via an unauthenticated HEAD.
            label = state.token_label(self.headers.get('X-Auth-Token', ''))
            if self.command != 'HEAD' and required and label == 'denied':
                state.count('remote_denied')
                self.reply(403, {'error': 'fixture_file_denied'})
                return
            state.count('remote_head' if self.command == 'HEAD' else 'remote_' + label)
            size = file.stat().st_size
            start, end, status = 0, size - 1, 200
            headers = {'Accept-Ranges': 'bytes'}
            header = self.headers.get('Range')
            if header:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
                if not match or not any(match.groups()):
                    self.reply(416, None, {'Content-Range': 'bytes */' + str(size)}, raw=b'')
                    return
                a, b = match.groups()
                if a:
                    start, end = int(a), min(int(b), size - 1) if b else size - 1
                else:
                    start = max(0, size - int(b))
                if start > end or start >= size:
                    self.reply(416, None, {'Content-Range': 'bytes */' + str(size)}, raw=b'')
                    return
                status = 206
                headers['Content-Range'] = f'bytes {start}-{end}/{size}'
                state.count('remote_range')
            count = max(0, end - start + 1)
            # Stream in bounded chunks; HEAD only exposes length, never file bytes.
            self.send_response(status)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(count))
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            if self.command == 'HEAD':
                return
            with file.open('rb') as stream:
                stream.seek(start)
                while count:
                    chunk = stream.read(min(count, 64 * 1024))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    count -= len(chunk)
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    state.origin = 'http://127.0.0.1:' + str(server.server_port)
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--catalog', required=True, type=Path)
    parser.add_argument('--port', default=0, type=int)
    parser.add_argument('--token-env', action='append', default=[])
    args = parser.parse_args(argv)
    try:
        tokens = [os.environ[name] for name in (args.token_env or ['WK_REPLAY_TOKEN'])]
        state = FixtureState(args.root, json.loads(args.catalog.read_text()), os.environ['WK_REPLAY_FIXTURE_KEY'], tokens,
                             os.environ.get('WK_REPLAY_FIXTURE_KEY_RUST'))
        server = make_server(state, args.port)
    except (ValueError, KeyError, TypeError, AttributeError, OSError):
        print(json.dumps({'ready': False, 'error': 'invalid_fixture_configuration'}), flush=True)
        return 2
    stop = threading.Event()
    def request_stop(*_):
        stop.set()
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(json.dumps({'ready': True, 'origin': state.origin}), flush=True)
    try:
        stop.wait()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        print(json.dumps({'stopped': True, 'counters': state.counters()}), flush=True)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
