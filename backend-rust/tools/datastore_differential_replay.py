#!/usr/bin/env python3
"""Read-only HTTP differential replay; see datastore_replay/README.md."""
import argparse
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HEADERS = ('content-type', 'content-encoding', 'content-disposition',
           'cache-control', 'content-range', 'location',
           'empty-bucket-indices', 'failure-bucket-indices', 'missing-buckets',
           'access-control-allow-origin', 'access-control-expose-headers')
SECRET = re.compile(r'token|authorization|cookie|password|secret|key', re.I)
READ = re.compile(r'/data/(?:v\d+/)?(?:health|datasets/[^/]+/(?:layers/[^/]+/(?:data|readData|findData|histogram|mappings(?:/[^/]+)?|layerThumbnail|connectomes(?:/synapses(?:/(?:positions|types|src|dst))?)?)|proxy/(?:datasource-properties\.json|layers/[^/]+/mags/(?:info|[^/]+/[^?]+)))|zarr[23]?/[^?]+)\Z')

class InvalidCorpus(ValueError):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def base_url(value):
    p = urllib.parse.urlsplit(value)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password or p.query or p.fragment or p.path not in ('', '/'):
        raise InvalidCorpus('endpoint must be an HTTP(S) origin without credentials')
    return value.rstrip('/')

def prepare(document, variables):
    if not isinstance(document, dict):
        raise InvalidCorpus('corpus must be an object')
    if document.get('version') != 1 or not isinstance(document.get('cases'), list) or not document['cases']:
        raise InvalidCorpus('expected version 1 and nonempty cases')
    cases = []
    names = set()
    for c in document['cases']:
        if not isinstance(c, dict):
            raise InvalidCorpus('case must be an object')
        if set(c) - {'name', 'path', 'method', 'query', 'query_env', 'headers_env', 'json', 'compare', 'expected_status', 'expected_sha256', 'expected_canonical_json_sha256'}:
            raise InvalidCorpus('unknown case field')
        name = c.get('name', '')
        if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,80}', name) or name in names:
            raise InvalidCorpus('case names must be unique safe identifiers')
        names.add(name)
        path = c['path']
        for key, value in variables.items():
            if not re.fullmatch(r'[A-Za-z0-9_.-]+', value):
                raise InvalidCorpus('variables must be safe path segments')
            path = path.replace('{' + key + '}', value)
        if '{' in path or '}' in path or '%' in path or '..' in path or '\\' in path or not READ.fullmatch(path):
            raise InvalidCorpus('path is not an approved read route')
        method = c.get('method', 'GET')
        if method not in ('GET', 'POST') or (method == 'POST' and not (path.endswith(('/data', '/readData')) or re.search(r'/connectomes/synapses(?:/(?:positions|types|src|dst))?$', path))):
            raise InvalidCorpus('method is not read-only for this route')
        query = c.get('query', {}).copy()
        if any(SECRET.search(k) for k in query):
            raise InvalidCorpus('credentials must use query_env or headers_env')
        headers = {'Accept-Encoding': 'identity'}
        for key, env in c.get('query_env', {}).items():
            if key != 'token' or not re.fullmatch(r'[A-Z][A-Z0-9_]*', env):
                raise InvalidCorpus('only token query environment credentials supported')
            if env not in os.environ:
                raise InvalidCorpus('required credential environment variable absent')
            query[key] = os.environ[env]
        for key, env in c.get('headers_env', {}).items():
            if key.lower() not in ('authorization', 'x-auth-token') or not re.fullmatch(r'[A-Z][A-Z0-9_]*', env):
                raise InvalidCorpus('unsupported credential header')
            if env not in os.environ:
                raise InvalidCorpus('required credential environment variable absent')
            headers[key] = os.environ[env]
        if any('\r' in v or '\n' in v for v in headers.values()):
            raise InvalidCorpus('invalid credential header')
        mode = c.get('compare', 'auto')
        if mode not in ('auto', 'json', 'bytes'):
            raise InvalidCorpus('comparison must be auto, json or bytes; JPEG tolerance deferred')
        body = None
        if 'json' in c:
            if method != 'POST':
                raise InvalidCorpus('GET body unsupported')
            body = json.dumps(c['json'], separators=(',', ':'), allow_nan=False).encode()
            headers['Content-Type'] = 'application/json'
        expected = c.get('expected_status')
        if expected is not None and (type(expected) is not int or not 100 <= expected <= 599):
            raise InvalidCorpus('expected_status must be an HTTP status integer')
        goldens = {}
        for field in ('expected_sha256', 'expected_canonical_json_sha256'):
            golden = c.get(field, {})
            if isinstance(golden, str):
                golden = {'scala': golden, 'rust': golden}
            if not isinstance(golden, dict) or (field in c and not golden) or set(golden) - {'scala', 'rust'} or any(not isinstance(v, str) or not re.fullmatch(r'[0-9a-f]{64}', v) for v in golden.values()):
                raise InvalidCorpus('expected digest must be a SHA256 string or per-endpoint object')
            goldens[field] = golden
        cases.append(dict(**goldens, expected_status=expected, name=name, path=path + ('?' + urllib.parse.urlencode(query, doseq=True) if query else ''), method=method, headers=headers, body=body, compare=mode))
    return cases

def fetch(origin, case, timeout, max_bytes):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    req = urllib.request.Request(origin + case['path'], data=case['body'], headers=case['headers'], method=case['method'])
    started = time.perf_counter()
    try:
        try:
            response = opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            response = e
        with response:
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                return dict(error='response_limit', ms=(time.perf_counter() - started) * 1000)
            return dict(status=response.code, headers={k: response.headers.get_all(k) for k in HEADERS}, body=body, ms=(time.perf_counter() - started) * 1000)
    except (OSError, ValueError):
        # Exception text can contain tokens, URLs, response text or header values.
        return dict(error='transport', ms=(time.perf_counter() - started) * 1000)

def normalized_header(key, values):
    if values is None:
        return None
    if key in ('empty-bucket-indices', 'failure-bucket-indices', 'missing-buckets'):
        try:
            return [json.loads(v) for v in values]
        except ValueError:
            pass
    if key == 'access-control-expose-headers':
        return sorted(x.strip().lower() for v in values for x in v.split(','))
    return [v.strip() for v in values]

def canonical_json(body):
    def invalid(value):
        raise ValueError('nonfinite JSON')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    return json.dumps(json.loads(body, parse_constant=invalid, object_pairs_hook=unique), sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def compare(left, right, mode):
    if 'error' in left or 'error' in right:
        return ['request_failed']  # two failures never establish parity
    differences = []
    if left['status'] != right['status']:
        differences.append('status')
    for key in HEADERS:
        if normalized_header(key, left['headers'][key]) != normalized_header(key, right['headers'][key]):
            differences.append('header:' + key)
    content_types = [r['headers']['content-type'] or [] for r in (left, right)]
    json_mode = mode == 'json' or (mode == 'auto' and all(any('application/json' in v.lower() for v in values) for values in content_types))
    if json_mode:
        try:
            same = canonical_json(left['body']) == canonical_json(right['body'])
        except (ValueError, UnicodeError):
            differences.append('invalid_json')
            same = False
    else:
        same = left['body'] == right['body']
    if not same:
        differences.append('body')
    return differences

def replay(scala, rust, cases, rounds=2, timeout=10, max_bytes=64 * 1024 * 1024):
    scala, rust = base_url(scala), base_url(rust)
    if rounds < 1 or timeout <= 0 or max_bytes < 1:
        raise InvalidCorpus('rounds, timeout and max-bytes must be positive')
    results = []
    for round_index in range(rounds):
        for case in cases:
            # Alternate ordering to reduce systematic latency bias.
            order = [('scala', scala), ('rust', rust)]
            if round_index % 2:
                order.reverse()
            responses = {name: fetch(origin, case, timeout, max_bytes) for name, origin in order}
            mismatch = compare(responses['scala'], responses['rust'], case['compare'])
            if case['expected_status'] is not None:
                for name, response in responses.items():
                    if response.get('status') != case['expected_status']:
                        mismatch.append('expected_status:' + name)
            for field in ('expected_sha256', 'expected_canonical_json_sha256'):
                for name, expected_digest in case[field].items():
                    response = responses[name]
                    try:
                        content = response['body']
                        if field == 'expected_canonical_json_sha256':
                            content = canonical_json(content).encode('utf-8')
                        digest = hashlib.sha256(content).hexdigest()
                    except (KeyError, ValueError, UnicodeError):
                        digest = None
                    if digest != expected_digest:
                        mismatch.append(field + ':' + name)
            results.append(dict(case=case['name'], round=round_index, phase='initial' if round_index == 0 else 'warm', differences=mismatch,
                                **{name: {k: v for k, v in response.items() if k in ('status', 'ms', 'error')} for name, response in responses.items()}))
    return dict(version=1, passed=not any(r['differences'] for r in results), results=results)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scala', required=True)
    parser.add_argument('--rust', required=True)
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--var', action='append', default=[], metavar='NAME=VALUE')
    parser.add_argument('--rounds', type=int, default=2)
    parser.add_argument('--timeout', type=float, default=10)
    parser.add_argument('--max-bytes', type=int, default=64 * 1024 * 1024)
    args = parser.parse_args(argv)
    try:
        variables = dict(v.split('=', 1) for v in args.var)
        cases = prepare(json.loads(args.corpus.read_text()), variables)
        report = replay(args.scala, args.rust, cases, args.rounds, args.timeout, args.max_bytes)
    except (ValueError, KeyError, TypeError, AttributeError, OSError):
        print(json.dumps({'passed': False, 'error': 'invalid_configuration_or_corpus'}))
        return 2
    print(json.dumps(report, indent=2))
    return 0 if report['passed'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
