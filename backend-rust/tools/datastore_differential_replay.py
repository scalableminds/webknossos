#!/usr/bin/env python3
"""Read-only HTTP differential replay; see datastore_replay/README.md."""
import argparse
import hashlib
import json
import os
import re
import struct
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
READ = re.compile(r'/data/(?:v\d+/)?(?:health|datasets/[^/]+/(?:layers/[^/]+/(?:data|readData|findData|histogram|mappings(?:/[^/]+)?|layerThumbnail|mag[^/]+/x[^/]+/y[^/]+/z[^/]+/bucket\.raw|agglomerates(?:/[^/]+/(?:tree|skeleton|agglomerateGraph)/[^/]+|/[^/]+/(?:largestAgglomerateId|positionForSegment|agglomeratesForSegments))?|meshes(?:/chunks(?:/data)?|/fullMesh\.stl)?|hasSegmentIndex|segmentStatisticsFile|segmentIndex(?:/[^/]+)?|segmentStatistics/(?:volume|boundingBox|surfaceArea|covarianceMatrix|maxDistance|centerOfMass|sphericity)|connectomes(?:/synapses(?:/(?:positions|types|src|dst))?)?|adHocMesh)|datasetThumbnail|proxy/(?:datasource-properties\.json|layers/[^/]+/(?:mags/(?:info|[^/]+/[^?]+)|attachments/[^/]+/[^/]+/[^?]+)))|(?:zarr[23]?|zarr3_experimental)/[^?]+)\Z')

# POST routes that only read (request bodies select data); every other POST is rejected.
READ_ONLY_POST = re.compile(r'/(?:data|readData|connectomes/synapses(?:/(?:positions|types|src|dst))?|agglomerates/[^/]+/agglomeratesForSegments|meshes/chunks(?:/data)?|meshes/fullMesh\.stl|segmentIndex(?:/[^/]+)?|segmentStatistics/[A-Za-z]+|adHocMesh|datasetThumbnail)\Z')

# Scala/Rust error chains embed the wall-clock instant of the failure; it can never match.
SERVER_TIME = re.compile(rb'\[Server Time \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\]')

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
    ambient = document.get('declared_differences', {})
    if not isinstance(ambient, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not v.strip()
                                            for k, v in ambient.items()):
        raise InvalidCorpus('declared_differences must map difference names to reasons')
    if set(document) - {'version', 'cases', 'declared_differences'}:
        raise InvalidCorpus('unknown corpus field')
    cases = []
    names = set()
    for c in document['cases']:
        if not isinstance(c, dict):
            raise InvalidCorpus('case must be an object')
        if set(c) - {'name', 'path', 'method', 'query', 'query_env', 'headers_env', 'json', 'body_hex', 'headers', 'compare', 'expected_status', 'expected_sha256', 'expected_canonical_json_sha256', 'declared_divergence'}:
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
        if method not in ('GET', 'POST') or (method == 'POST' and not READ_ONLY_POST.search(path)):
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
        for key, value in c.get('headers', {}).items():
            # Plain request headers that select data; credentials only via headers_env.
            if key.lower() != 'range' or not isinstance(value, str) or not re.fullmatch(r'bytes=[0-9]*-[0-9]*', value):
                raise InvalidCorpus('only plain Range request headers supported')
            headers[key] = value
        if any('\r' in v or '\n' in v for v in headers.values()):
            raise InvalidCorpus('invalid credential header')
        mode = c.get('compare', 'auto')
        if mode not in ('auto', 'json', 'json-set', 'bytes', 'image', 'skeleton-proto', 'stl'):
            raise InvalidCorpus('comparison must be auto, json, json-set, bytes, image, skeleton-proto or stl')
        if mode == 'image':
            try:
                import PIL.Image  # noqa: F401  (only image corpora need Pillow)
            except ImportError:
                raise InvalidCorpus('image comparison needs Pillow') from None
        body = None
        if 'json' in c:
            if method != 'POST':
                raise InvalidCorpus('GET body unsupported')
            body = json.dumps(c['json'], separators=(',', ':'), allow_nan=False).encode()
            headers['Content-Type'] = 'application/json'
        if 'body_hex' in c:
            # Binary request bodies (protobuf ListOfLong for agglomeratesForSegments).
            if method != 'POST' or body is not None or not isinstance(c['body_hex'], str):
                raise InvalidCorpus('body_hex needs a POST without json')
            try:
                body = bytes.fromhex(c['body_hex'])
            except ValueError:
                raise InvalidCorpus('body_hex must be hexadecimal') from None
            headers['Content-Type'] = 'application/octet-stream'
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
        declared = c.get('declared_divergence')
        if declared is not None:
            # A declared divergence never hides an unlisted difference, and each side must have its
            # own independent oracle (or a numeric bound), so two wrong answers cannot pass.
            if (not isinstance(declared, dict) or set(declared) - {'reason', 'differences', 'max_byte_delta', 'unverified'}
                    or not isinstance(declared.get('reason'), str) or not declared['reason'].strip()
                    or not isinstance(declared.get('differences'), list) or not declared['differences']
                    or any(not isinstance(d, str) for d in declared['differences'])):
                raise InvalidCorpus('declared_divergence needs a reason and a nonempty differences list')
            delta = declared.get('max_byte_delta')
            if delta is not None and (type(delta) is not int or not 0 < delta < 256 or mode != 'bytes'):
                raise InvalidCorpus('max_byte_delta must be a small positive integer on a bytes comparison')
            oracle_sides = set(goldens.get('expected_sha256', {})) | set(goldens.get('expected_canonical_json_sha256', {}))
            if declared.get('unverified') not in (None, True):
                raise InvalidCorpus('declared_divergence.unverified must be true when present')
            if oracle_sides != {'scala', 'rust'} and not (delta is not None and oracle_sides) and not declared.get('unverified'):
                raise InvalidCorpus('declared divergence needs an oracle per side (or one oracle plus max_byte_delta)')
        cases.append(dict(**goldens, declared_divergence=declared, ambient=ambient, expected_status=expected, name=name, path=path + ('?' + urllib.parse.urlencode(query, doseq=True) if query else ''), method=method, headers=headers, body=body, compare=mode))
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

def canonical_json_value(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def without_chain(body):
    """An error body without its `{"chain": …}` cause entries (exception text of each runtime)."""
    try:
        value = json.loads(body)
    except ValueError:
        return None
    if not isinstance(value, dict) or not isinstance(value.get('messages'), list):
        return None
    return [m for m in value['messages'] if not (isinstance(m, dict) and set(m) == {'chain'})]

# SkeletonTracing.proto creation timestamps (wall clock at generation): message path -> field number.
# Tracing.createdTimestamp=3; trees=2 -> Tree.createdTimestamp=8, nodes=2 -> Node.createdTimestamp=9,
# branchPoints=5 -> BranchPoint.createdTimestamp=2.
SKELETON_TIMESTAMPS = {(): 3, (2,): 8, (2, 2): 9, (2, 5): 2}
SKELETON_MESSAGES = {(2,), (2, 2), (2, 5)}

def protobuf_fields(data):
    fields, i = [], 0
    def varint():
        nonlocal i
        value = shift = 0
        while True:
            byte = data[i]
            i += 1
            value |= (byte & 0x7f) << shift
            shift += 7
            if byte < 0x80:
                return value
    while i < len(data):
        key = varint()
        number, wire = key >> 3, key & 7
        start = i
        if wire == 0:
            varint()
        elif wire == 1:
            i += 8
        elif wire == 2:
            length = varint()
            start, i = i, i + length
        elif wire == 5:
            i += 4
        else:
            raise ValueError('unsupported wire type')
        if i > len(data):
            raise ValueError('truncated protobuf')
        fields.append((number, wire, data[start:i]))
    return fields

def skeleton_without_timestamps(data, path=()):
    """Field list with the creation timestamps removed; nested trees/nodes/branch points recursed."""
    result = []
    for number, wire, value in protobuf_fields(data):
        if SKELETON_TIMESTAMPS.get(path) == number:
            continue
        child = path + (number,)
        result.append((number, wire, skeleton_without_timestamps(value, child) if child in SKELETON_MESSAGES else value))
    return result

# Binary STL facet normals come from native float32 cross products; compilers that contract a*b-c*d
# into FMA (clang on arm64) differ from plain IEEE evaluation by about one ulp of a unit vector.
STL_NORMAL_TOLERANCE = 1e-6

def stl_equal(left, right):
    """(header, count, vertices and attribute bytes identical; normals within tolerance)."""
    if len(left) != len(right) or len(left) < 84 or left[:84] != right[:84]:
        return False, True
    count = struct.unpack_from('<I', left, 80)[0]
    if len(left) != 84 + 50 * count:
        raise ValueError('not a binary STL')
    normals = True
    for offset in range(84, len(left), 50):
        if left[offset + 12:offset + 50] != right[offset + 12:offset + 50]:
            return False, True
        a, b = struct.unpack_from('<3f', left, offset), struct.unpack_from('<3f', right, offset)
        normals = normals and all(abs(x - y) <= STL_NORMAL_TOLERANCE for x, y in zip(a, b))
    return True, normals

def decoded_image(body):
    import io
    import PIL.Image
    with PIL.Image.open(io.BytesIO(body)) as image:
        return image.size, image.mode, image.tobytes()

def compare(left, right, mode):
    if 'error' in left or 'error' in right:
        return ['request_failed']  # two failures never establish parity
    differences = []
    if left['status'] != right['status']:
        differences.append('status')
    for key in HEADERS:
        if normalized_header(key, left['headers'][key]) != normalized_header(key, right['headers'][key]):
            differences.append('header:' + key)
    protobuf = all(any('protobuf' in v.lower() for v in (r['headers']['content-type'] or [])) for r in (left, right))
    content_types = [r['headers']['content-type'] or [] for r in (left, right)]
    both_json = all(any('application/json' in v.lower() for v in values) for values in content_types)
    if mode == 'skeleton-proto' and not protobuf or mode in ('image', 'stl') and both_json:
        mode = 'auto'  # error answers are JSON
    if mode == 'stl':
        try:
            same, normals = stl_equal(left['body'], right['body'])
        except (ValueError, struct.error):
            same, normals = left['body'] == right['body'], True
        return differences + ([] if same else ['body']) + ([] if normals else ['stl-normals'])
    if mode == 'skeleton-proto':
        try:
            same = skeleton_without_timestamps(left['body']) == skeleton_without_timestamps(right['body'])
        except (IndexError, ValueError):
            same = left['body'] == right['body']
        if not same:
            differences.append('body')
        return differences
    if mode == 'image':
        # Encoders differ (Java ImageIO vs Rust); the decoded pixels are the contract.
        try:
            same = decoded_image(left['body']) == decoded_image(right['body'])
        except (OSError, ValueError):
            differences.append('invalid_image')
            same = False
        if not same:
            differences.append('image')
        return differences
    if mode == 'json-set' and both_json:
        # Scala `Set` results (unspecified order); compared as multisets of canonical items.
        try:
            values = [json.loads(r['body']) for r in (left, right)]
            if all(isinstance(v, list) for v in values):
                same = sorted(map(canonical_json_value, values[0])) == sorted(map(canonical_json_value, values[1]))
                return differences + ([] if same else ['body'])
        except ValueError:
            pass
        mode = 'json'
    json_mode = mode == 'json' or (mode == 'auto' and both_json)
    if json_mode:
        try:
            same = (canonical_json(SERVER_TIME.sub(b'[Server Time]', left['body']))
                    == canonical_json(SERVER_TIME.sub(b'[Server Time]', right['body'])))
            stripped = [without_chain(r['body']) for r in (left, right)]
            if not same and stripped[0] is not None and stripped[0] == stripped[1]:
                differences.append('error-chain')  # same status/error, only the debug cause chain differs
                return differences
        except (ValueError, UnicodeError):
            differences.append('invalid_json')
            same = False
    else:
        same = left['body'] == right['body']
    if not same:
        differences.append('body')
    return differences

def dump(dump_dir, case_name, responses):
    """Diagnostic copy of a mismatching pair; never part of the report."""
    for name, response in responses.items():
        stem = dump_dir / (case_name + '.' + name)
        meta = {k: v for k, v in response.items() if k in ('status', 'headers', 'error')}
        stem.with_suffix(stem.suffix + '.json').write_text(json.dumps(meta, indent=2) + '\n')
        if 'body' in response:
            stem.with_suffix(stem.suffix + '.body').write_bytes(response['body'])

def replay(scala, rust, cases, rounds=2, timeout=10, max_bytes=64 * 1024 * 1024, dump_dir=None):
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
            declared, declared_differences = case.get('declared_divergence'), []
            # Corpus-wide categories (e.g. error-chain wording): allowed wherever they occur.
            ambient = case.get('ambient') or {}
            declared_differences += [d for d in mismatch if d in ambient]
            mismatch = [d for d in mismatch if d not in ambient]
            if declared is not None:
                allowed = set(declared['differences'])
                declared_differences += [d for d in mismatch if d in allowed]
                mismatch = [d for d in mismatch if d not in allowed]
                if not any(d in allowed for d in declared_differences):
                    mismatch.append('declared_divergence_resolved')  # update the corpus
                delta = declared.get('max_byte_delta')
                if delta is not None and 'body' in declared_differences:
                    left, right = responses['scala'].get('body', b''), responses['rust'].get('body', b'')
                    if len(left) != len(right) or any(abs(a - b) > delta for a, b in zip(left, right)):
                        mismatch.append('max_byte_delta_exceeded')
            if dump_dir is not None and (mismatch or declared_differences) and round_index == 0:
                dump(dump_dir, case['name'], responses)
            extra = dict(declared=declared['reason'], declared_differences=declared_differences,
                         **({'declared_unverified': True} if declared.get('unverified') else {})) if declared else (
                dict(declared_differences=declared_differences) if declared_differences else {})
            results.append(dict(case=case['name'], round=round_index, phase='initial' if round_index == 0 else 'warm', differences=mismatch, **extra,
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
