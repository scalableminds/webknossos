"""Upload phase of run_live_replay.py (DC1e): resumable dataset-upload sequences, step by step against
both datastores.

Each side has its own Redis, upload base directory (organization-agnostic, allowsUpload) and WK
key, so the fixture WK records its upload RPCs per side. After every step the HTTP answer, the Redis
upload metadata (keys, values, expiry in days) and the upload base directory tree (paths and file
digests, hidden staging/trash directories included) are compared; at the end the recorded WK calls
(reserve/report/delete/unfinished) too. Only the per-side base directory path is normalized.

Scala finishes some cleanup after answering (cancel and failed finishes delete Redis keys in an
unawaited future), so differing state is re-read for up to SETTLE_SECONDS; the step records how
long it took (`settled_ms`). Error answers that differ only in the `{"chain": …}` cause entries
(Java exception vs Rust error text) count as `answer-chain`: tolerated like the breadth corpus's
`error-chain`, but listed.
"""
import hashlib
import io
import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BOUNDARY = 'dc1e-boundary-7f3a'
SETTLE_SECONDS = 3
SERVER_TIME = re.compile(r'\[Server Time [^\]]+\]')
# Finished mag/attachment uploads move to `<layer>/<mag or attachment>__<ObjectId.generate>`.
GENERATED_ID = re.compile(r'__[0-9a-f]{24}\b')
ZARRAY = {'zarr_format': 2, 'shape': [32, 32, 32], 'chunks': [32, 32, 32], 'dtype': '|u1', 'order': 'F',
          'compressor': None, 'fill_value': 0, 'filters': None, 'dimension_separator': '.'}
CHUNK = bytes((x * 7 + y * 3 + z) & 255 for z in range(32) for y in range(32) for x in range(32))
MAG_ZARRAY = dict(ZARRAY, shape=[16, 16, 16], chunks=[16, 16, 16])
MAG_CHUNK = bytes((x + y * 5 + z * 9) & 255 for z in range(16) for y in range(16) for x in range(16))


def dataset_id(name):
    """fixture_server.FixtureState.reserve: the id WK assigns to an uploaded dataset."""
    return 'f00000' + hashlib.sha256(name.encode()).hexdigest()[:18]


def properties(name):
    return {'id': {'name': name, 'team': 'replay-org'}, 'scale': {'factor': [11.24, 11.24, 28], 'unit': 'nanometer'},
            'dataLayers': [{'name': 'color', 'category': 'color', 'elementClass': 'uint8', 'dataFormat': 'zarr',
                            'boundingBox': {'topLeft': [0, 0, 0], 'width': 32, 'height': 32, 'depth': 32},
                            'numChannels': 1, 'mags': [{'mag': [1, 1, 1], 'path': './color/1'}]}]}


def zipped(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 17, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    return buffer.getvalue()


def reserve_body(upload_id, name, files, total_size=None, needs_conversion=None, **extra):
    info = {'uploadId': upload_id, 'totalFileCount': len(files), 'filePaths': files}
    if total_size is not None:
        info['totalFileSizeInBytes'] = total_size
    body = {'resumableUploadInfo': info, 'datasetName': name, 'organizationId': 'replay-org', 'initialTeamIds': [],
            **extra}
    if needs_conversion is not None:
        body['needsConversion'] = needs_conversion
    return body


def scenarios():
    """(scenario, [(step, request)]); request = (method, path, query, kind, payload, token label)."""
    with_properties = zipped([('wrapper/datasource-properties.json', json.dumps(properties('zip-ds')).encode()),
                              ('wrapper/color/1/.zarray', json.dumps(ZARRAY).encode()),
                              ('wrapper/color/1/0.0.0', CHUNK),
                              ('wrapper/notes.txt', b'not referenced by the datasource'),
                              ('wrapper/.DS_Store', b'hidden'), ('__MACOSX/wrapper/._x', b'resource fork')])
    half = len(with_properties) // 2
    explore = zipped([('raw/color/1/.zarray', json.dumps(ZARRAY).encode()), ('raw/color/1/0.0.0', CHUNK)])
    folder = [('folder/datasource-properties.json', json.dumps(properties('folder-ds')).encode()),
              ('folder/color/1/.zarray', json.dumps(ZARRAY).encode()), ('folder/color/1/0.0.0', CHUNK)]
    base = '/data/datasets/upload/'
    up = base + 'dataset'

    def chunk(upload_id, file, data, number=1, total=1, chunk_size=None, domain='dataset'):
        return ('POST', base + domain, {}, 'multipart', {'resumableChunkNumber': number,
                'resumableChunkSize': chunk_size or len(data), 'resumableCurrentChunkSize': len(data),
                'resumableTotalChunks': total, 'resumableIdentifier': f'{upload_id}/{file}', 'file': data}, 'primary')

    def test(upload_id, file, number, domain='dataset'):
        return ('GET', base + domain, {'resumableChunkNumber': str(number), 'resumableIdentifier': f'{upload_id}/{file}'},
                None, None, 'primary')

    def finish(upload_id, domain='dataset'):
        return ('POST', base + domain + '/finishUpload', {'uploadId': upload_id}, 'json', {}, 'primary')

    def cancel(upload_id, domain='dataset'):
        return ('POST', base + domain + '/cancelUpload', {'uploadId': upload_id}, 'json', {}, 'primary')

    def reserve(body, token='primary', domain='dataset'):
        return ('POST', base + domain + '/reserveUpload', {}, 'json', body, token)

    unfinished = ('GET', up + '/unfinishedUploads', {'organizationName': 'replay-org'}, None, None, 'primary')
    yield 'zip-with-properties', [
        ('reserve-denied', reserve(reserve_body('dc1e-zip', 'zip-ds', ['zip-ds.zip']), 'denied')),
        ('reserve-invalid-body', reserve({'resumableUploadInfo': {'uploadId': 'dc1e-zip'}})),
        ('reserve', reserve(reserve_body('dc1e-zip', 'zip-ds', ['zip-ds.zip'], len(with_properties)))),
        ('reserve-again', reserve(reserve_body('dc1e-zip', 'zip-ds', ['zip-ds.zip'], len(with_properties)))),
        ('unfinished', unfinished),
        ('test-chunk-1-before', test('dc1e-zip', 'zip-ds.zip', 1)),
        ('finish-before-chunks', finish('dc1e-zip')),
        ('chunk-1', chunk('dc1e-zip', 'zip-ds.zip', with_properties[:half], 1, 2, half)),
        ('test-chunk-1-after', test('dc1e-zip', 'zip-ds.zip', 1)),
        ('test-chunk-2-before', test('dc1e-zip', 'zip-ds.zip', 2)),
        ('chunk-unknown-upload', chunk('dc1e-unknown', 'x.zip', b'x')),
        ('chunk-2', chunk('dc1e-zip', 'zip-ds.zip', with_properties[half:], 2, 2, half)),
        ('finish', finish('dc1e-zip')),
        ('finish-again', finish('dc1e-zip')),
        ('unfinished-after', unfinished),
    ]
    yield 'zip-explored', [
        ('reserve', reserve(reserve_body('dc1e-explore', 'explore-ds', ['explore-ds.zip']))),
        ('chunk', chunk('dc1e-explore', 'explore-ds.zip', explore)),
        ('finish', finish('dc1e-explore')),
    ]
    yield 'folder', [
        ('reserve', reserve(reserve_body('dc1e-folder', 'folder-ds', [p for p, _ in folder]))),
        *[(f'chunk-{index}', chunk('dc1e-folder', path, data)) for index, (path, data) in enumerate(folder)],
        ('finish', finish('dc1e-folder')),
    ]
    yield 'cancel', [
        ('reserve', reserve(reserve_body('dc1e-cancel', 'cancel-ds', ['cancel-ds.zip']))),
        ('chunk-1', chunk('dc1e-cancel', 'cancel-ds.zip', with_properties[:half], 1, 2, half)),
        ('cancel-unknown', cancel('dc1e-unknown')),
        ('cancel', cancel('dc1e-cancel')),
        ('test-chunk-after-cancel', test('dc1e-cancel', 'cancel-ds.zip', 1)),
        ('unfinished-after', unfinished),
    ]
    yield 'size-exceeded', [
        ('reserve', reserve(reserve_body('dc1e-size', 'size-ds', ['size-ds.zip'], 16))),
        ('chunk', chunk('dc1e-size', 'size-ds.zip', with_properties)),
        ('finish', finish('dc1e-size')),
    ]
    yield 'too-many-files', [
        ('reserve', reserve(reserve_body('dc1e-files', 'files-ds', ['a.zip']))),
        ('chunk-a', chunk('dc1e-files', 'a.zip', explore)),
        ('chunk-b', chunk('dc1e-files', 'b.zip', explore)),
        ('finish', finish('dc1e-files')),
    ]
    yield 'needs-conversion', [
        ('reserve', reserve(reserve_body('dc1e-convert', 'convert-ds', ['stack.tif'], needs_conversion=True))),
        ('chunk', chunk('dc1e-convert', 'stack.tif', b'II*\0' + bytes(60))),
        ('finish', finish('dc1e-convert')),
    ]
    yield from mag_and_attachment_scenarios(chunk, test, finish, cancel, reserve)


def mag_and_attachment_scenarios(chunk, test, finish, cancel, reserve):
    """Mag and attachment uploads into the dataset uploaded by `zip-with-properties` (layer `color`)."""
    target = dataset_id('zip-ds')

    def resumable(upload_id, files, total_size):
        info = {'uploadId': upload_id, 'totalFileCount': len(files), 'filePaths': files}
        return info if total_size is None else dict(info, totalFileSizeInBytes=total_size)

    def mag_body(upload_id, files, mag, total_size=None, layer='color'):
        return {'resumableUploadInfo': resumable(upload_id, files, total_size), 'datasetId': target,
                'layerName': layer, 'mag': {'mag': mag}, 'overwritePending': False}

    def attachment_body(upload_id, files, name, kind, data_format, total_size=None):
        return {'resumableUploadInfo': resumable(upload_id, files, total_size), 'datasetId': target,
                'layerName': 'color', 'attachmentType': kind,
                'attachment': {'name': name, 'path': 'pending', 'dataFormat': data_format}, 'overwritePending': False}

    mag_zip = zipped([('mag2/.zarray', json.dumps(MAG_ZARRAY).encode()), ('mag2/0.0.0', MAG_CHUNK),
                      ('mag2/.DS_Store', b'hidden')])
    mag_folder = [('4/.zarray', json.dumps(MAG_ZARRAY).encode()), ('4/0.0.0', MAG_CHUNK)]
    hdf5 = b'\x89HDF\r\n\x1a\n' + bytes(56)
    mesh_zip = zipped([('meshfile/zarr.json', b'{"zarr_format":3,"node_type":"group"}'), ('meshfile/c/0', b'1234')])
    m, a = {'domain': 'mag'}, {'domain': 'attachment'}
    yield 'mag-zip', [
        ('reserve-denied', reserve(mag_body('dc1e-mag', ['mag.zip'], [2, 2, 2]), 'denied', **m)),
        ('reserve-invalid-body', reserve({'resumableUploadInfo': {'uploadId': 'dc1e-mag'}, 'datasetId': target}, **m)),
        ('reserve-unknown-layer', reserve(mag_body('dc1e-mag', ['mag.zip'], [2, 2, 2], layer='other'), **m)),
        ('reserve', reserve(mag_body('dc1e-mag', ['mag.zip'], [2, 2, 2], len(mag_zip)), **m)),
        ('reserve-again', reserve(mag_body('dc1e-mag', ['mag.zip'], [2, 2, 2], len(mag_zip)), **m)),
        ('unfinished-mag', ('GET', '/data/datasets/upload/mag/unfinishedUploads', {'organizationName': 'replay-org'},
                            None, None, 'primary')),
        ('test-chunk-before', test('dc1e-mag', 'mag.zip', 1, **m)),
        ('finish-before-chunks', finish('dc1e-mag', **m)),
        ('chunk', chunk('dc1e-mag', 'mag.zip', mag_zip, **m)),
        ('test-chunk-after', test('dc1e-mag', 'mag.zip', 1, **m)),
        ('test-chunk-wrong-domain', test('dc1e-mag', 'mag.zip', 1)),
        ('finish-wrong-domain', finish('dc1e-mag', domain='attachment')),
        ('finish', finish('dc1e-mag', **m)),
        ('finish-again', finish('dc1e-mag', **m)),
    ]
    yield 'mag-folder', [
        ('reserve', reserve(mag_body('dc1e-mag-folder', [p for p, _ in mag_folder], [4, 4, 4]), **m)),
        *[(f'chunk-{index}', chunk('dc1e-mag-folder', path, data, **m)) for index, (path, data) in enumerate(mag_folder)],
        ('finish', finish('dc1e-mag-folder', **m)),
    ]
    yield 'mag-size-exceeded', [
        ('reserve', reserve(mag_body('dc1e-mag-size', ['mag.zip'], [8, 8, 8], 16), **m)),
        ('chunk', chunk('dc1e-mag-size', 'mag.zip', mag_zip, **m)),
        ('finish', finish('dc1e-mag-size', **m)),
    ]
    yield 'mag-cancel', [
        ('reserve', reserve(mag_body('dc1e-mag-cancel', ['mag.zip'], [16, 16, 16]), **m)),
        ('chunk', chunk('dc1e-mag-cancel', 'mag.zip', mag_zip, **m)),
        ('cancel', cancel('dc1e-mag-cancel', **m)),
        ('test-chunk-after-cancel', test('dc1e-mag-cancel', 'mag.zip', 1, **m)),
    ]
    yield 'attachment-hdf5', [
        ('reserve-denied', reserve(attachment_body('dc1e-att', ['view.hdf5'], 'Agglomerate Ü view #5', 'agglomerate',
                                                   'hdf5'), 'denied', **a)),
        ('reserve-invalid-type', reserve(attachment_body('dc1e-att', ['view.hdf5'], 'view', 'volume', 'hdf5'), **a)),
        ('reserve', reserve(attachment_body('dc1e-att', ['view.hdf5'], 'Agglomerate Ü view #5', 'agglomerate', 'hdf5',
                                            len(hdf5)), **a)),
        ('chunk', chunk('dc1e-att', 'view.hdf5', hdf5, **a)),
        ('finish', finish('dc1e-att', **a)),
    ]
    yield 'attachment-zarr3-zip', [
        ('reserve', reserve(attachment_body('dc1e-att-mesh', ['mesh.zip'], 'meshfile', 'mesh', 'zarr3'), **a)),
        ('chunk', chunk('dc1e-att-mesh', 'mesh.zip', mesh_zip, **a)),
        ('finish', finish('dc1e-att-mesh', **a)),
    ]
    yield 'attachment-unnamed', [
        ('reserve', reserve(attachment_body('dc1e-att-none', ['x.hdf5'], '###', 'segmentIndex', 'hdf5'), **a)),
        ('chunk', chunk('dc1e-att-none', 'x.hdf5', hdf5, **a)),
        ('finish', finish('dc1e-att-none', **a)),
        ('cancel-finished', cancel('dc1e-att-none', **a)),
    ]
    yield 'unknown-domain', [
        ('finish', finish('dc1e-mag', domain='volume')),
        ('test-chunk', test('dc1e-mag', 'mag.zip', 1, domain='volume')),
    ]


def multipart(fields):
    body = bytearray()
    for name, value in fields.items():
        if name == 'file':
            continue
        body += f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    body += f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\n'.encode()
    body += b'Content-Type: application/octet-stream\r\n\r\n' + fields['file'] + f'\r\n--{BOUNDARY}--\r\n'.encode()
    return bytes(body)


def send(origin, request, tokens):
    method, path, query, kind, payload, token = request
    query = dict(query, token=tokens[token])
    headers, data = {}, None
    if kind == 'json':
        headers['Content-Type'], data = 'application/json', json.dumps(payload).encode()
    elif kind == 'multipart':
        headers['Content-Type'], data = f'multipart/form-data; boundary={BOUNDARY}', multipart(payload)
    url = origin + path + '?' + urllib.parse.urlencode(query)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = opener.open(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=120)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers.get('Content-Type'), response.read()


class Redis:
    """Minimal RESP client: enough for KEYS/TYPE/GET/SMEMBERS/HGETALL/TTL snapshots."""

    def __init__(self, port):
        self.sock = socket.create_connection(('127.0.0.1', port), timeout=10)
        self.stream = self.sock.makefile('rb')

    def close(self):
        self.stream.close()
        self.sock.close()

    def command(self, *args):
        out = b'*%d\r\n' % len(args) + b''.join(b'$%d\r\n%s\r\n' % (len(a), a) for a in (x.encode() for x in args))
        self.sock.sendall(out)
        return self.reply()

    def reply(self):
        line = self.stream.readline()[:-2]
        kind, rest = line[:1], line[1:]
        if kind in (b'+', b':'):
            return int(rest) if kind == b':' else rest.decode()
        if kind == b'-':
            raise RuntimeError(rest.decode())
        if kind == b'$':
            size = int(rest)
            return None if size < 0 else self.stream.read(size + 2)[:-2].decode()
        if kind == b'*':
            return [self.reply() for _ in range(int(rest))]
        raise RuntimeError('unexpected RESP reply')

    def snapshot(self):
        result = {}
        for key in sorted(self.command('KEYS', '*')):
            kind = self.command('TYPE', key)
            if kind == 'string':
                value = self.command('GET', key)
            elif kind == 'set':
                value = sorted(self.command('SMEMBERS', key))
            elif kind == 'hash':
                pairs = self.command('HGETALL', key)
                value = dict(sorted(zip(pairs[::2], pairs[1::2])))
            else:
                value = kind
            ttl = self.command('TTL', key)
            result[key] = {'value': value, 'expiry_days': round(ttl / 86400) if ttl > 0 else ttl}
        return result


def tree(root):
    """Relative path -> file digest (or 'dir'), hidden staging/trash directories included; generated ids
    of finished mag/attachment directories normalized."""
    result = {}
    for path in sorted(root.rglob('*')):
        relative = str(path.relative_to(root))
        if path.is_symlink():
            result[relative] = 'symlink'
        elif path.is_dir():
            result[relative] = 'dir'
        else:
            result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    return {GENERATED_ID.sub('__<OBJECTID>', key): value for key, value in result.items()}


def normalized(value, root):
    """JSON-comparable form: the side's upload base directory becomes <UPLOAD_ROOT>, server time dropped."""
    text = json.dumps(value, sort_keys=True, ensure_ascii=False)
    for form in {str(root), str(root.resolve())}:
        text = text.replace(form, '<UPLOAD_ROOT>')
    return json.loads(GENERATED_ID.sub('__<OBJECTID>', SERVER_TIME.sub('[Server Time]', text)))


def answer(status, content_type, body, root):
    try:
        parsed = normalized(json.loads(body), root) if body else None
    except ValueError:
        parsed = {'text': SERVER_TIME.sub('[Server Time]', body.decode('utf-8', 'replace')).replace(str(root), '<UPLOAD_ROOT>')}
    return {'status': status, 'content_type': content_type, 'body': parsed}


def without_chain(answer):
    body = answer['body']
    if not isinstance(body, dict) or not isinstance(body.get('messages'), list):
        return None
    return dict(answer, body=dict(body, messages=[m for m in body['messages'] if set(m) != {'chain'}]))


def upload_calls(fixture_origin, side, root):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(fixture_origin + '/upload-calls?side=' + side, timeout=30) as response:
        return normalized(json.loads(response.read()), root)


def run(origins, redis_ports, roots, fixture_origin, tokens):
    """Replays every scenario on both sides; returns the report (every step, every difference)."""
    sides = ('scala', 'rust')
    clients = {side: Redis(redis_ports[side]) for side in sides}
    steps = []
    try:
        for scenario, sequence in scenarios():
            for step, request in sequence:
                entry = {'scenario': scenario, 'step': step, 'differences': []}
                for side in sides:
                    status, content_type, body = send(origins[side], request, tokens)
                    entry[side] = {'answer': answer(status, content_type, body, roots[side])}
                started = time.monotonic()
                while True:
                    for side in sides:
                        entry[side].update(redis=normalized(clients[side].snapshot(), roots[side]), tree=tree(roots[side]))
                    settled = all(entry['scala'][part] == entry['rust'][part] for part in ('redis', 'tree'))
                    if settled or time.monotonic() - started > SETTLE_SECONDS:
                        break
                    time.sleep(.1)
                entry['settled_ms'] = round((time.monotonic() - started) * 1000)
                answers = entry['scala']['answer'], entry['rust']['answer']
                if answers[0] != answers[1]:
                    chainless = [without_chain(a) for a in answers]
                    same_error = chainless[0] is not None and chainless[0] == chainless[1]
                    entry['differences'].append('answer-chain' if same_error else 'answer')
                for part in ('redis', 'tree'):
                    if entry['scala'][part] != entry['rust'][part]:
                        entry['differences'].append(part)
                steps.append(entry)
        calls = {side: upload_calls(fixture_origin, side, roots[side]) for side in sides}
    finally:
        for client in clients.values():
            client.close()
    label = lambda e, d: f"{e['scenario']}/{e['step']}:{d}"
    differences = [label(e, d) for e in steps for d in e['differences'] if d != 'answer-chain']
    if calls['scala'] != calls['rust']:
        differences.append('wk-calls')
    return {'passed': not differences, 'differences': differences,
            'chain_only': [label(e, d) for e in steps for d in e['differences'] if d == 'answer-chain'],
            'delayed_cleanup': {f"{e['scenario']}/{e['step']}": e['settled_ms'] for e in steps if e['settled_ms'] >= 100},
            'steps': steps, 'wk_calls': calls}
