import contextlib
import importlib.util
import io
import hashlib
import json
import os
from pathlib import Path
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('replay', Path(__file__).with_name('datastore_differential_replay.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

@contextlib.contextmanager
def server(status=200, body=b'{"a":1,"b":2}', headers=None):
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.respond()
        def do_POST(self):
            self.respond()
        def respond(self):
            calls.append((self.command, self.path, dict(self.headers), self.rfile.read(int(self.headers.get('Content-Length', '0')))))
            self.send_response(status)
            for k, v in (headers or {'Content-Type': 'application/json'}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *args):
            pass
    http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        yield 'http://127.0.0.1:' + str(http.server_port), calls
    finally:
        http.shutdown()
        http.server_close()
        thread.join()

def document(**case):
    return {'version': 1, 'cases': [dict(name='case', path='/data/health', **case)]}

class ReplayTests(unittest.TestCase):
    def test_actual_post_credentials_warm_rounds_and_json_order(self):
        corpus = document(method='POST', json=[{'position': [0, 0, 0], 'mag': [1, 1, 1], 'cubeSize': 32}], query_env={'token': 'REPLAY_TOKEN'})
        corpus['cases'][0]['path'] = '/data/datasets/{id}/layers/color/data'
        with patch.dict(os.environ, REPLAY_TOKEN='private-value'), server() as (left, lc), server(body=b'{"b":2,"a":1}') as (right, rc):
            cases = r.prepare(corpus, {'id': '012345678901234567890123'})
            result = r.replay(left, right, cases, rounds=3)
        self.assertTrue(result['passed'])
        self.assertEqual(len(lc), 3)
        self.assertEqual([(m, p, {k: v for k, v in h.items() if k != 'Host'}, b) for m, p, h, b in lc],
                         [(m, p, {k: v for k, v in h.items() if k != 'Host'}, b) for m, p, h, b in rc])
        self.assertEqual(lc[0][0], 'POST')
        self.assertIn('token=private-value', lc[0][1])
        self.assertEqual(json.loads(lc[0][3]), corpus['cases'][0]['json'])
        self.assertEqual([x['phase'] for x in result['results']], ['initial', 'warm', 'warm'])
        self.assertNotIn('private-value', json.dumps(result))
        self.assertTrue(all(x['scala']['ms'] >= 0 for x in result['results']))

    def test_missing_headers_presence_and_binary_bytes(self):
        headers = {'Content-Type': 'application/octet-stream', 'MISSING-BUCKETS': '[1, 2]', 'empty-bucket-indices': '[1]', 'failure-bucket-indices': '[2]'}
        cases = r.prepare(document(compare='bytes'), {})
        with server(body=b'\x00\xff', headers=headers) as (a, _), server(body=b'\x00\xff', headers=dict(headers, **{'MISSING-BUCKETS': '[1,2]'})) as (b, _):
            self.assertTrue(r.replay(a, b, cases)['passed'])
        with server(body=b'\x00\xff', headers=headers) as (a, _), server(body=b'\x00\xfe', headers={'Content-Type': 'application/octet-stream'}) as (b, _):
            result = r.replay(a, b, cases, 1)
        self.assertEqual(result['results'][0]['differences'], ['header:empty-bucket-indices', 'header:failure-bucket-indices', 'header:missing-buckets', 'body'])

    def test_status_errors_and_mismatch_cli_exit(self):
        cases = r.prepare(document(), {})
        with server(status=403) as (a, _), server(status=404) as (b, _), patch.object(Path, 'read_text', return_value=json.dumps(document())), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(r.main(['--scala', a, '--rust', b, '--corpus', 'unused', '--rounds', '1']), 1)
        self.assertEqual(json.loads(out.getvalue())['results'][0]['differences'], ['status'])
        with server(status=403) as (a, _), server(status=403) as (b, _):
            self.assertTrue(r.replay(a, b, cases, 1)['passed'])

    def test_absolute_golden_independent_of_pair_equality(self):
        digest = hashlib.sha256(b'golden').hexdigest()
        cases = r.prepare(document(compare='bytes', expected_sha256=digest), {})
        with server(body=b'wrong', headers={'Content-Type': 'application/octet-stream'}) as (a, _), server(body=b'wrong', headers={'Content-Type': 'application/octet-stream'}) as (b, _):
            report = r.replay(a, b, cases, 1)
        self.assertEqual(report['results'][0]['differences'], ['expected_sha256:scala', 'expected_sha256:rust'])
        cases = r.prepare(document(compare='bytes', expected_sha256={'scala': digest}), {})
        with server(body=b'golden', headers={'Content-Type': 'application/octet-stream'}) as (a, _), server(body=b'different', headers={'Content-Type': 'application/octet-stream'}) as (b, _):
            report = r.replay(a, b, cases, 1)
        self.assertEqual(report['results'][0]['differences'], ['body'])
        cases = r.prepare(document(expected_canonical_json_sha256=hashlib.sha256(r.canonical_json(b'{"a":1,"b":2}').encode()).hexdigest()), {})
        with server() as (a, _), server(body=b'{"b":2,"a":1}') as (b, _):
            self.assertTrue(r.replay(a, b, cases, 1)['passed'])
        for expected in ('bad', {'other': digest}, {}, {'scala': 'bad'}):
            with self.assertRaises(r.InvalidCorpus):
                r.prepare(document(expected_sha256=expected), {})

    def test_equal_denials_do_not_pass_expected_success(self):
        cases = r.prepare(document(expected_status=200), {})
        with server(status=403) as (a, _), server(status=403) as (b, _):
            result = r.replay(a, b, cases, 1)
        self.assertEqual(result['results'][0]['differences'], ['expected_status:scala', 'expected_status:rust'])

    def test_redirect_is_not_followed(self):
        with server() as (destination, dc), server(status=302, headers={'Location': destination + '/data/health?token=private'}) as (a, ac):
            response = r.fetch(a, r.prepare(document(), {})[0], 1, 1000)
            self.assertEqual(response['status'], 302)
            self.assertEqual(len(ac), 1)
            self.assertEqual(dc, [])

    def test_cache_range_redirect_contracts_without_secret_output(self):
        cases = r.prepare(document(compare='bytes'), {})
        headers = {'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=1',
                   'Content-Range': 'bytes 0-1/10', 'Location': 'https://example.test/a?token=scala-secret'}
        other = dict(headers, **{'Cache-Control': 'no-store', 'Content-Range': 'bytes 0-1/20',
                                'Location': 'https://example.test/b?token=rust-secret'})
        with server(status=302, body=b'', headers=headers) as (a, ac), server(status=302, body=b'', headers=other) as (b, bc):
            report = r.replay(a, b, cases, 1)
        self.assertFalse(report['passed'])
        self.assertEqual(report['results'][0]['differences'],
                         ['header:cache-control', 'header:content-range', 'header:location'])
        self.assertEqual(len(ac), 1)
        self.assertEqual(len(bc), 1)
        output = json.dumps(report)
        for secret in ('scala-secret', 'rust-secret', 'example.test', 'max-age=1', 'bytes 0-1/20'):
            self.assertNotIn(secret, output)
        # Presence is also part of each contract, even for otherwise matching bodies.
        with server(body=b'xy', headers=headers) as (a, _), server(body=b'xy', headers={'Content-Type': 'application/octet-stream'}) as (b, _):
            report = r.replay(a, b, cases, 1)
        self.assertEqual(report['results'][0]['differences'],
                         ['header:cache-control', 'header:content-range', 'header:location'])

    def test_response_limit_and_failed_requests_never_pass(self):
        cases = r.prepare(document(), {})
        with server(body=b'x' * 20) as (a, _), server(body=b'x' * 20) as (b, _):
            result = r.replay(a, b, cases, 1, max_bytes=10)
        self.assertFalse(result['passed'])
        self.assertEqual(result['results'][0]['scala']['error'], 'response_limit')
        self.assertEqual(r.compare({'error': 'transport'}, {'error': 'transport'}, 'auto'), ['request_failed'])

    def test_security_and_no_tolerance(self):
        for path in ('/data/checkInboxBlocking', '/data/datasets/id/reload', '//evil/data/health', '/data/zarr/id/../x', '/data/zarr/id/%2e%2e/x', '/data/zarr/id?token=x'):
            d = document()
            d['cases'][0]['path'] = path
            with self.subTest(path=path), self.assertRaises(r.InvalidCorpus):
                r.prepare(d, {})
        for case in ({'method': 'DELETE'}, {'method': 'POST'}, {'query': {'token': 'secret'}}, {'compare': 'jpeg'}, {'query_env': {'token': 'missing'}}, {'headers_env': {'Host': 'HOST'}}, {'headers': {'Authorization': 'literal'}}, {'expected_status': True}):
            with self.subTest(case=case), self.assertRaises(r.InvalidCorpus):
                r.prepare(document(**case), {})
        for value in ('http://user:secret@localhost', 'file:///tmp/x', 'http://localhost?token=secret', 'http://localhost/data'):
            with self.assertRaises(r.InvalidCorpus):
                r.base_url(value)

    def test_binary_body_and_range_header(self):
        agglomerates = '/data/datasets/id/layers/seg/agglomerates/agg/agglomeratesForSegments'
        case = r.prepare({'version': 1, 'cases': [{'name': 'proto', 'path': agglomerates, 'method': 'POST',
                                                   'body_hex': '0a020102'}]}, {})[0]
        self.assertEqual((case['body'], case['headers']['Content-Type']), (b'\x0a\x02\x01\x02', 'application/octet-stream'))
        proxy = '/data/datasets/id/proxy/layers/color/mags/1-1-1/0.0.0'
        case = r.prepare({'version': 1, 'cases': [{'name': 'range', 'path': proxy, 'headers': {'Range': 'bytes=0-15'}}]}, {})[0]
        self.assertEqual(case['headers']['Range'], 'bytes=0-15')
        for bad in ({'path': agglomerates, 'body_hex': '0a'}, {'path': agglomerates, 'method': 'POST', 'body_hex': 'zz'},
                    {'path': agglomerates, 'method': 'POST', 'body_hex': '0a', 'json': []},
                    {'path': proxy, 'headers': {'Range': 'bytes=0-1\r\nX: y'}}, {'path': proxy, 'headers': {'Cookie': 'a'}}):
            with self.subTest(case=bad), self.assertRaises(r.InvalidCorpus):
                r.prepare({'version': 1, 'cases': [dict(name='bad', **bad)]}, {})

    def test_declared_divergence_needs_oracles_and_never_hides_other_differences(self):
        a, b = b'\x10\x20', b'\x11\x20'
        sha = lambda x: hashlib.sha256(x).hexdigest()
        declared = {'reason': 'documented', 'differences': ['body']}
        with self.assertRaises(r.InvalidCorpus):  # no oracle per side
            r.prepare(document(compare='bytes', declared_divergence=declared), {})
        with self.assertRaises(r.InvalidCorpus):  # empty reason
            r.prepare(document(compare='bytes', declared_divergence=dict(declared, reason=' '),
                               expected_sha256={'scala': sha(a), 'rust': sha(b)}), {})
        cases = r.prepare(document(compare='bytes', declared_divergence=declared,
                                   expected_sha256={'scala': sha(a), 'rust': sha(b)}), {})
        octet = {'Content-Type': 'application/octet-stream'}
        with server(body=a, headers=octet) as (left, _), server(body=b, headers=octet) as (right, _):
            result = r.replay(left, right, cases, 1)
        self.assertTrue(result['passed'])
        self.assertEqual(result['results'][0]['declared_differences'], ['body'])
        with server(body=a, headers=octet) as (left, _), server(body=b, headers={'Content-Type': 'text/plain'}) as (right, _):
            result = r.replay(left, right, cases, 1)
        self.assertEqual(result['results'][0]['differences'], ['header:content-type'])
        with server(body=a, headers=octet) as (left, _), server(body=a, headers=octet) as (right, _):
            result = r.replay(left, right, cases, 1)
        self.assertIn('declared_divergence_resolved', result['results'][0]['differences'])

    def test_declared_byte_delta_and_unverified(self):
        a = b'\x10\x20'
        sha = lambda x: hashlib.sha256(x).hexdigest()
        bounded = {'reason': 'rounding', 'differences': ['body'], 'max_byte_delta': 1}
        cases = r.prepare(document(compare='bytes', declared_divergence=bounded, expected_sha256={'scala': sha(a)}), {})
        octet = {'Content-Type': 'application/octet-stream'}
        for other, ok in ((b'\x11\x1f', True), (b'\x12\x20', False), (b'\x10', False)):
            with server(body=a, headers=octet) as (left, _), server(body=other, headers=octet) as (right, _):
                self.assertEqual(r.replay(left, right, cases, 1)['passed'], ok, other)
        with self.assertRaises(r.InvalidCorpus):  # a bound needs a bytes comparison
            r.prepare(document(declared_divergence=bounded, expected_sha256={'scala': sha(a)}), {})
        unverified = {'reason': 'cache dependent', 'differences': ['body'], 'unverified': True}
        cases = r.prepare(document(compare='bytes', declared_divergence=unverified), {})
        with server(body=a, headers=octet) as (left, _), server(body=b'\x00', headers=octet) as (right, _):
            result = r.replay(left, right, cases, 1)
        self.assertTrue(result['passed'])
        self.assertTrue(result['results'][0]['declared_unverified'])

    def test_error_chain_server_time_is_ignored_but_nothing_else(self):
        chain = lambda t, m='x': json.dumps({'messages': [{'error': m}, {'chain': f'[Server Time {t}] cause'}]}).encode()
        cases = r.prepare(document(), {})
        with server(body=chain('2026-10-17T08:36:48.304Z')) as (a, _), server(body=chain('2026-10-17T08:36:49.011Z')) as (b, _):
            self.assertTrue(r.replay(a, b, cases, 1)['passed'])
        with server(body=chain('2026-10-17T08:36:48.304Z')) as (a, _), server(body=chain('2026-10-17T08:36:48.304Z', 'y')) as (b, _):
            self.assertEqual(r.replay(a, b, cases, 1)['results'][0]['differences'], ['body'])

    def test_json_set_order_and_image_json_fallback(self):
        cases = r.prepare(document(compare='json-set'), {})
        with server(body=b'["a","b"]') as (a, _), server(body=b'["b","a"]') as (b, _):
            self.assertTrue(r.replay(a, b, cases, 1)['passed'])
        for other in (b'["a"]', b'["a","a","b"]', b'{"a":1}'):
            with server(body=b'["a","b"]') as (a, _), server(body=other) as (b, _):
                self.assertEqual(r.replay(a, b, cases, 1)['results'][0]['differences'], ['body'], other)
        # Image cases answered with JSON errors on both sides compare as JSON (server time ignored).
        cases = r.prepare(document(compare='image'), {})
        chain = lambda t: json.dumps({'messages': [{'error': 'x'}, {'chain': f'[Server Time {t}] y'}]}).encode()
        with server(body=chain('2026-10-17T08:36:48.304Z')) as (a, _), server(body=chain('2026-10-17T08:36:49Z')) as (b, _):
            self.assertTrue(r.replay(a, b, cases, 1)['passed'])
        with server(body=b'not an image', headers={'Content-Type': 'image/jpeg'}) as (a, _), \
                server(body=b'not an image', headers={'Content-Type': 'image/jpeg'}) as (b, _):
            self.assertIn('invalid_image', r.replay(a, b, cases, 1)['results'][0]['differences'])

    def test_stl_vertices_exact_normals_bounded(self):
        import struct
        def stl(normal, vertex=1.0):
            return b'\0' * 80 + struct.pack('<I', 1) + struct.pack('<12f', *normal, vertex, 0, 0, 0, 1, 0, 0, 0, 1) + b'\0\0'
        octet = {'Content-Type': 'application/octet-stream'}
        cases = r.prepare(document(compare='stl'), {})
        for right, expected in ((stl((0, 0, 1.0)), []), (stl((0, 1.2e-7, 1.0)), []), (stl((0, 1e-3, 1.0)), ['stl-normals']),
                                (stl((0, 0, 1.0), vertex=1.0000001), ['body']), (stl((0, 0, 1.0))[:-1], ['body'])):
            with server(body=stl((0, 0, 1.0)), headers=octet) as (a, _), server(body=right, headers=octet) as (b, _):
                self.assertEqual(r.replay(a, b, cases, 1)['results'][0]['differences'], expected)

    def test_error_chain_category_and_corpus_wide_declaration(self):
        err = lambda m, c: json.dumps({'messages': [{'error': m}, {'chain': c}]}).encode()
        plain = r.prepare(document(), {})
        doc = document()
        doc['declared_differences'] = {'error-chain': 'exception wording'}
        ambient = r.prepare(doc, {})
        with server(status=400, body=err('x', 'java text')) as (a, _), server(status=400, body=err('x', 'rust text')) as (b, _):
            self.assertEqual(r.replay(a, b, plain, 1)['results'][0]['differences'], ['error-chain'])
            result = r.replay(a, b, ambient, 1)
        self.assertTrue(result['passed'])
        self.assertEqual(result['results'][0]['declared_differences'], ['error-chain'])
        with server(status=400, body=err('x', 'c')) as (a, _), server(status=400, body=err('y', 'c')) as (b, _):
            self.assertEqual(r.replay(a, b, ambient, 1)['results'][0]['differences'], ['body'])
        with self.assertRaises(r.InvalidCorpus):
            r.prepare(dict(doc, declared_differences={'error-chain': ''}), {})

    def test_checked_in_corpora_validate(self):
        directory = Path(__file__).with_name('datastore_replay')
        with patch.dict(os.environ, WK_REPLAY_TOKEN='fixture-token', WK_REPLAY_DENIED_TOKEN='denied-token'):
            for path in directory.glob('*.json'):
                with self.subTest(corpus=path.name):
                    cases = r.prepare(json.loads(path.read_text()), {'dataset': '012345678901234567890123', 'layer': 'color'})
                    self.assertTrue(cases)
                    self.assertTrue(all(c['expected_status'] is not None for c in cases))

    def test_json_types_arrays_duplicates_and_nonfinite(self):
        self.assertNotEqual(r.canonical_json(b'{"a":true}'), r.canonical_json(b'{"a":1}'))
        self.assertNotEqual(r.canonical_json(b'[1,2]'), r.canonical_json(b'[2,1]'))
        for body in (b'{"a":1,"a":2}', b'NaN', b'bad'):
            with self.assertRaises(ValueError):
                r.canonical_json(body)

if __name__ == '__main__':
    unittest.main()
