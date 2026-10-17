#!/usr/bin/env python3
"""Assemble immutable paired datastore replay fixtures using only Python stdlib.

Run from any directory. Writes only beneath a new /tmp output directory. Source
fixtures are copied unchanged; the original native/Scala goldens remain the oracle.
The catalog's path placeholders are resolved by fixture_server.py.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import gzip
import struct
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'datastore/tests/fixtures'
ORG = 'replay-org'
# Readable for the fixture WK, but its datasource RPC answers 404 (error-chains.json probes).
BROKEN_DATASET = '000000bad000000000000404'


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def digest(data):
    return hashlib.sha256(data).hexdigest()


class Catalog:
    def __init__(self, output):
        self.output = output
        self.datasets = []
        self.cases = []
        self.goldens = {}
        self.remote = {}
        self.divergences = []

    def dataset(self, name, fmt, element, origin, bounds, axis, native=None, scale_child=False):
        identity = f'{len(self.datasets) + 1:024x}'
        relative = f'datasets/{ORG}/{name}'
        directory = self.output / relative
        mag = directory / 'color/1'
        mag.mkdir(parents=True)
        if native:
            target = mag.parent if scale_child else mag
            shutil.copytree(FIXTURES / native, target, dirs_exist_ok=True)
        locator = {'mag': [1, 1, 1], 'path': '${FIXTURE_ROOT}/' + relative + '/color/1'}
        if axis is not None:
            locator['axisOrder'] = axis
        source = {'id': {'name': name, 'team': ORG}, 'scale': [1, 1, 1], 'dataLayers': [{
            'name': 'color', 'category': 'color', 'elementClass': element,
            'dataFormat': fmt, 'boundingBox': {'topLeft': origin, 'width': bounds[0], 'height': bounds[1], 'depth': bounds[2]},
            'mags': [locator]}]}
        record = {'datasetId': identity, 'dataSource': source, 'rootPath': relative}
        self.datasets.append(record)
        return record, mag

    def case(self, record, name, position, size, expected, endpoint='readData', divergence=None,
             max_byte_delta=None):
        identity = record['datasetId']
        body = {'position': position, 'mag': [1, 1, 1], 'cubeSize': size}
        if endpoint == 'data':
            body = [dict(body, cubeSize=size[0])]
        case = {'name': name, 'path': f'/data/datasets/{identity}/layers/color/{endpoint}',
                'method': 'POST', 'json': body, 'compare': 'bytes', 'expected_status': 200,
                'query_env': {'token': 'WK_REPLAY_TOKEN'}}
        self.cases.append(case)
        golden = {'expected_status': 200, 'body_length': len(expected), 'sha256': digest(expected)}
        if divergence:
            golden['golden_service'] = 'rust' if divergence.startswith('Scala ') else 'scala'
            golden['intentional_divergence'] = divergence
            self.divergences.append({'case': name, 'reason': divergence, 'comparison': 'strict bytes; included in default corpus'})
        else:
            golden['golden_service'] = 'both'
        self.goldens[name] = golden
        target = self.output / 'goldens' / (name + '.bin')
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(expected)
        side = golden['golden_service']
        case['expected_sha256'] = ({'scala': digest(expected), 'rust': digest(expected)} if side == 'both' else {side: digest(expected)})
        if divergence:
            case['declared_divergence'] = {'reason': divergence, 'differences': ['body']}
            if max_byte_delta is not None:
                case['declared_divergence']['max_byte_delta'] = max_byte_delta
        if name in ('compressed-segmentation-seg32', 'compressed-segmentation-bits32'):
            values = struct.unpack('<' + str(len(expected) // 4) + 'I', expected)
            if name.endswith('bits32'):
                # Scala (1 << 32) - 1 is zero: every index selects the first LUT value.
                values = (values[0],) * len(values)
            # ByteUtils.intToBytes shifts by four bits, so successive bytes overlap nibbles.
            scala = bytes((value >> (4 * i)) & 255 for value in values for i in range(4))
            scala_hash = digest(scala)
            (target.parent / (name + '-scala.bin')).write_bytes(scala)
            case['expected_sha256']['scala'] = scala_hash
            golden['scala_sha256'] = scala_hash
            golden['scala_emulation'] = 'ByteUtils.intToBytes shift4' + (' and packed-index mask0' if name.endswith('bits32') else '')

    def finish(self):
        for record in self.datasets:
            # Local metadata resolves to concrete immutable runtime paths; RPC catalog uses placeholders.
            local = json.loads(json.dumps(record['dataSource']).replace('${FIXTURE_ROOT}', str(self.output)))
            write_json(self.output / record['rootPath'] / 'datasource-properties.json', local)
        write_json(self.output / 'catalog.json', {'version': 1, 'organization': ORG, 'datastore': 'replay-ds',
                    'datasets': self.datasets, 'remoteFiles': self.remote,
                    'brokenDatasets': {BROKEN_DATASET: 404}})
        write_json(self.output / 'corpus.json', {'version': 1, 'cases': self.cases})
        write_json(self.output / 'goldens.json', {'version': 1, 'cases': self.goldens, 'intentional_divergences': self.divergences})
        files = []
        for file in sorted(self.output.rglob('*')):
            if file.is_file():
                files.append({'path': str(file.relative_to(self.output)), 'length': file.stat().st_size, 'sha256': digest(file.read_bytes())})
        write_json(self.output / 'manifest.json', {'version': 1, 'files': files})


def build(output, attachments=False, bench=False):
    c = Catalog(output)
    xyz = {'x': 0, 'y': 1, 'z': 2}
    cxyz = {'c': 0, 'x': 1, 'y': 2, 'z': 3}
    for variant in ('raw', 'lz4', 'lz4hc'):
        record, _ = c.dataset('wkw-' + variant, 'wkw', 'uint24', [0, 0, 0], [16, 8, 8], None, 'wkw/' + variant)
        c.case(record, 'wkw-' + variant + '-cross-shards', [3, 2, 1], [10, 5, 6], (FIXTURES / f'wkw/{variant}/expected.bin').read_bytes())
    # Independent zarr2 chunks, including a missing in-bounds second chunk and clipping.
    record, mag = c.dataset('zarr2-raw', 'zarr', 'uint8', [0, 0, 0], [64, 32, 32], xyz)
    write_json(mag / '.zarray', {'zarr_format': 2, 'shape': [64, 32, 32], 'chunks': [32, 32, 32],
                              'dtype': '|u1', 'order': 'F', 'compressor': None, 'fill_value': 0})
    (mag / '0.0.0').write_bytes(bytes((x + 13*y + 37*z) % 256 for z in range(32) for y in range(32) for x in range(32)))
    expected = bytes((x + 13*y + 37*z) % 256 for z in range(2, 4) for y in range(2, 4) for x in range(2, 4))
    c.case(record, 'zarr2-coordinate-crop', [2, 2, 2], [2, 2, 2], expected)
    c.case(record, 'zarr2-missing-fill', [32, 0, 0], [2, 2, 2], bytes(8))
    c.case(record, 'zarr2-clipped', [-1, 0, 0], [2, 1, 1], bytes([0, 0]))
    archive = mag.parent / 'data.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as writer:
        for file in sorted(mag.rglob('*')):
            if file.is_file():
                info = zipfile.ZipInfo('color/1/' + str(file.relative_to(mag)), date_time=(2020, 1, 1, 0, 0, 0))
                writer.writestr(info, file.read_bytes())
    for remote in (False, True):
        zipped, _ = c.dataset('zip-zarr2-' + ('http' if remote else 'local'), 'zarr', 'uint8', [0, 0, 0], [64, 32, 32], xyz)
        if remote:
            alias = 'zarr2.zip'
            c.remote[alias] = {'path': str(archive.relative_to(output)), 'requireToken': True}
            locator = '${FIXTURE_ORIGIN}/files/' + alias
        else:
            locator = '${FIXTURE_ROOT}/' + str(archive.relative_to(output))
        zipped['dataSource']['dataLayers'][0]['mags'][0]['path'] = locator + '|zip:color/1'
        c.case(zipped, 'zip-zarr2-' + ('http' if remote else 'local') + '-crop', [2, 2, 2], [2, 2, 2], expected,
               divergence='Scala Play3.0.12 withHttpHeaders rebuilds headers from empty TreeMap and drops X-Auth-Token on ranged ZIP reads; native/Rust bytes retained' if remote else None)
        if remote:
            # Scala's denied ranged read fails the bucket, which readData answers with zero fill.
            c.cases[-1]['expected_sha256']['scala'] = digest(bytes(len(expected)))
    for variant in ('little_f', 'big_c', 'gzip', 'zstd', 'blosc', 'crc', 'shard_start', 'shard_end'):
        record, _ = c.dataset('zarr3-' + variant.replace('_', '-'), 'zarr3', 'uint16', [0, 0, 0], [7, 6, 5], cxyz, 'zarr3/' + variant)
        c.case(record, 'zarr3-' + variant.replace('_', '-') + '-crop', [1, 1, 1], [6, 5, 4], (FIXTURES / f'zarr3/{variant}/expected.bin').read_bytes())
    record, _ = c.dataset('n5-gzip', 'n5', 'uint16', [1, 2, 3], [8, 8, 8], xyz, 'n5/real_gzip')
    c.case(record, 'n5-gzip-crop', [1, 2, 3], [8, 8, 8], (FIXTURES / 'n5/real_gzip/expected.bin').read_bytes())
    for variant in ('raw', 'shard_identity', 'shard_gzip', 'shard_murmur'):
        record, _ = c.dataset('precomputed-' + variant.replace('_', '-'), 'neuroglancerPrecomputed', 'uint16', [5, 7, 11], [5, 4, 3], xyz, 'precomputed/' + variant, True)
        c.case(record, 'precomputed-' + variant.replace('_', '-') + '-crop', [6, 8, 12], [4, 3, 2], (FIXTURES / f'precomputed/{variant}/expected.bin').read_bytes())
    for variant in ('u4_plain', 'u4_shard_raw', 'u4_shard_gzip'):
        record, _ = c.dataset('compresso-' + variant.replace('_', '-'), 'neuroglancerPrecomputed', 'uint32', [5, 7, 11], [7, 5, 3], xyz, 'compresso/volumes/' + variant, True)
        c.case(record, 'compresso-' + variant.replace('_', '-') + '-full', [5, 7, 11], [7, 5, 3], (FIXTURES / f'compresso/volumes/{variant}/expected_full.raw').read_bytes())
    for name, volume, block, dtype in [('seg32', [5, 4, 3], [2, 3, 2], 'uint32'), ('seg64', [5, 4, 3], [2, 3, 2], 'uint64'), ('bits32', [2, 1, 1], [2, 1, 1], 'uint32')]:
        record, mag = c.dataset('compressed-segmentation-' + name, 'neuroglancerPrecomputed', dtype, [0, 0, 0], volume, xyz)
        write_json(mag.parent / 'info', {'type': 'segmentation', 'data_type': dtype, 'num_channels': 1,
                   'scales': [{'key': '1', 'size': volume, 'resolution': [1, 1, 1], 'chunk_sizes': [volume],
                               'encoding': 'compressed_segmentation', 'compressed_segmentation_block_size': block}]})
        (mag / '_'.join('0-' + str(n) for n in volume)).write_bytes((FIXTURES / f'precomputed/{name}.encoded').read_bytes())
        c.case(record, 'compressed-segmentation-' + name, [0, 0, 0], volume, (FIXTURES / f'precomputed/{name}.decoded').read_bytes(),
               divergence=('Scala full-width32 packed-index mask selects first LUT value and ByteUtils.intToBytes shifts4 instead of8; Rust matches native golden' if name == 'bits32'
                           else 'Scala ByteUtils.intToBytes shifts4 instead of8, corrupting uint32 serialization; Rust matches native golden' if name == 'seg32' else None))
    for variant in ('gray_baseline', 'gray_progressive'):
        record, mag = c.dataset('jpeg-' + variant.replace('_', '-'), 'neuroglancerPrecomputed', 'uint8', [0, 0, 0], [16, 32, 1], xyz)
        write_json(mag.parent / 'info', {'type': 'image', 'data_type': 'uint8', 'num_channels': 1,
                   'scales': [{'key': '1', 'size': [16, 32, 1], 'resolution': [1, 1, 1], 'chunk_sizes': [[16, 32, 1]], 'encoding': 'jpeg'}]})
        shutil.copyfile(FIXTURES / f'precomputed/{variant}.jpeg', mag / '0-16_0-32_0-1')
        c.case(record, 'jpeg-' + variant.replace('_', '-'), [0, 0, 0], [16, 32, 1], (FIXTURES / f'precomputed/{variant}.decoded').read_bytes(),
               divergence='Java ImageIO versus pure-Rust JPEG IDCT rounding differs by up to one gray level; Rust bounded by max_byte_delta against Scala',
               max_byte_delta=1)
    if attachments:
        record, mag = c.dataset('connectome-attachments', 'zarr', 'uint8', [0, 0, 0], [32, 32, 32], xyz)
        write_json(mag / '.zarray', {'zarr_format': 2, 'shape': [32, 32, 32], 'chunks': [32, 32, 32],
                                  'dtype': '|u1', 'order': 'F', 'compressor': None, 'fill_value': 0})
        layer = record['dataSource']['dataLayers'][0]
        layer.update(name='seg', category='segmentation', largestSegmentId=7)
        attachment_root = output / record['rootPath'] / 'seg/attachments'
        attachment_root.mkdir(parents=True)
        attachments_list = []
        for name, source, fmt in [('hdf', 'contiguous.hdf5', 'hdf5'), ('filtered', 'chunked_v4.hdf5', 'hdf5'), ('zarr', 'zarr3', 'zarr3')]:
            target = attachment_root / source
            native = FIXTURES / 'connectomes' / source
            if native.is_dir():
                shutil.copytree(native, target)
            else:
                shutil.copyfile(native, target)
            attachments_list.append({'name': name, 'path': '${FIXTURE_ROOT}/' + str(target.relative_to(output)), 'dataFormat': fmt})
        layer['attachments'] = {'connectomes': attachments_list}
        for name in ('hdf', 'filtered', 'zarr'):
            oracle = json.loads((FIXTURES / 'connectomes' / ('scala_zarr_oracle.json' if name == 'zarr' else 'scala_oracle.json')).read_text())
            for endpoint, body, expected in [
                ('synapses', {'agglomerateIds': [4, 2]}, next(case['value'] for case in oracle['synapses'] if case['ids'] == [4, 2])),
                ('synapses/positions', {'synapseIds': oracle['selected']}, oracle['positions']),
                ('synapses/types', {'synapseIds': oracle['selected']}, oracle['types']),
                ('synapses/dst', {'synapseIds': oracle['selected']}, [{'customJsonEncoding': 'bigint', 'value': str(v)} for v in oracle['dst']]),
            ]:
                case_name = 'connectome-' + name + '-' + endpoint.replace('/', '-')
                case = {'name': case_name, 'path': '/data/datasets/' + record['datasetId'] + '/layers/seg/connectomes/' + endpoint,
                        'method': 'POST', 'json': dict(body, connectomeFile=name), 'compare': 'json', 'expected_status': 200,
                        'query_env': {'token': 'WK_REPLAY_TOKEN'}}
                json_hash = digest(json.dumps(expected, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())
                case['expected_canonical_json_sha256'] = {'scala': json_hash, 'rust': json_hash}
                c.cases.append(case)
                c.goldens[case_name] = {'expected_status': 200, 'expected_json': expected, 'golden_service': 'both',
                                       'canonical_json_sha256': json_hash}
        attachment_routes(c, output)
    if bench:
        bench_datasets(c)
    c.finish()
    return c


BENCH_SHAPE = (512, 512, 256)


def bench_datasets(c):
    """Two 512x512x256 uint8 layers (zlib Zarr2, gzip Zarr3) for the load phase; 2048 chunks of 32^3 each.

    One structured base chunk, shifted per chunk index with a byte table, so generation runs at C speed."""
    n = 32
    value = lambda x, y, z: (x * 7 + y * 3 + z * 5 + ((x * y) >> 4)) & 255
    base_f = bytes(value(x, y, z) for z in range(n) for y in range(n) for x in range(n))  # x fastest
    base_c = bytes(value(x, y, z) for x in range(n) for y in range(n) for z in range(n))  # z fastest
    chunks = [(cx, cy, cz) for cx in range(BENCH_SHAPE[0] // n) for cy in range(BENCH_SHAPE[1] // n)
              for cz in range(BENCH_SHAPE[2] // n)]
    shift = lambda cx, cy, cz: bytes((i + cx * 11 + cy * 13 + cz * 17) & 255 for i in range(256))
    record, mag = c.dataset('bench-zarr2-zlib', 'zarr', 'uint8', [0, 0, 0], list(BENCH_SHAPE), {'x': 0, 'y': 1, 'z': 2})
    write_json(mag / '.zarray', {'zarr_format': 2, 'shape': list(BENCH_SHAPE), 'chunks': [n, n, n], 'dtype': '|u1',
                                 'order': 'F', 'compressor': {'id': 'zlib', 'level': 1}, 'fill_value': 0})
    for cx, cy, cz in chunks:
        (mag / f'{cx}.{cy}.{cz}').write_bytes(zlib.compress(base_f.translate(shift(cx, cy, cz)), 1))
    record, mag = c.dataset('bench-zarr3-gzip', 'zarr3', 'uint8', [0, 0, 0], list(BENCH_SHAPE),
                            {'c': 0, 'x': 1, 'y': 2, 'z': 3})
    write_json(mag / 'zarr.json', {'zarr_format': 3, 'node_type': 'array', 'shape': [1, *BENCH_SHAPE], 'data_type': 'uint8',
                                   'chunk_grid': {'name': 'regular', 'configuration': {'chunk_shape': [1, n, n, n]}},
                                   'chunk_key_encoding': {'name': 'default', 'configuration': {'separator': '/'}},
                                   'fill_value': 0, 'codecs': [{'name': 'bytes', 'configuration': {'endian': 'little'}},
                                                               {'name': 'gzip', 'configuration': {'level': 1}}]})
    for cx, cy, cz in chunks:
        target = mag / 'c' / '0' / str(cx) / str(cy) / str(cz)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(gzip.compress(base_c.translate(shift(cx, cy, cz)), 1, mtime=0))


def list_of_long(values):
    """Protobuf ListOfLong (field 1, packed uint64) as hex, the agglomeratesForSegments body."""
    payload = bytearray()
    for value in values:
        while True:
            byte, value = value & 0x7f, value >> 7
            payload.append(byte | (0x80 if value else 0))
            if not value:
                break
    return (bytes([0x0a, len(payload)]) + payload).hex() if payload else ''


def attachment_routes(c, output):
    """Segmentation with agglomerate, mesh and segment-index attachments copied from native test fixtures.

    Pair-compared only (pair-corpus.json, replayed with the breadth phase): the fixtures were made for
    file-level oracles, so these cases check Scala/Rust agreement, not correctness."""
    record, mag = c.dataset('attachments-seg', 'zarr', 'uint8', [0, 0, 0], [32, 32, 32], {'x': 0, 'y': 1, 'z': 2})
    write_json(mag / '.zarray', {'zarr_format': 2, 'shape': [32, 32, 32], 'chunks': [32, 32, 32],
                                 'dtype': '|u1', 'order': 'F', 'compressor': None, 'fill_value': 0})
    # Fortran order: x fastest. Segments 1..5 in x bands of 7 voxels.
    (mag / '0.0.0').write_bytes(bytes(1 + x // 7 for _z in range(32) for _y in range(32) for x in range(32)))
    layer = record['dataSource']['dataLayers'][0]
    layer.update(name='seg', category='segmentation', largestSegmentId=5)
    root = output / record['rootPath'] / 'seg/attachments'
    root.mkdir(parents=True)

    def attach(kind, name, source, fmt):
        target = root / kind / Path(source).name
        target.parent.mkdir(exist_ok=True)
        (shutil.copytree if (FIXTURES / source).is_dir() else shutil.copyfile)(FIXTURES / source, target)
        return {'name': name, 'path': '${FIXTURE_ROOT}/' + str(target.relative_to(output)), 'dataFormat': fmt}

    layer['attachments'] = {
        'agglomerates': [attach('agglomerates', 'agg', 'agglomerates/contiguous.hdf5', 'hdf5'),
                         attach('agglomerates', 'real100', 'agglomerates/real_100.hdf5', 'hdf5')],
        'meshes': [attach('meshes', 'local', 'meshes/local.hdf5', 'hdf5'),
                   attach('meshes', 'gzip', 'meshes/gzip.hdf5', 'hdf5'),
                   attach('meshes', 'zarr', 'meshes/zarr3', 'zarr3'),
                   # Real Draco fragments (segments 11, 30, 33): fullMesh.stl decodes and stitches them.
                   attach('meshes', 'real', 'meshes/real.hdf5', 'hdf5')],
        'segmentIndex': attach('segmentIndex', 'idx', 'segment_index/real_l4_sample.hdf5', 'hdf5'),
    }
    # JSON mappings live next to the mags (`<layer>/mappings/*.json`), not in the attachments.
    mappings = output / record['rootPath'] / 'seg/mappings'
    mappings.mkdir()
    write_json(mappings / 'classes.json', {'name': 'classes', 'classes': [[1, 2], [3, 4, 5]]})
    (mappings / 'broken.json').write_text('{"name": "broken", "classes": [[1, ')
    (mappings / 'notes.txt').write_text('not a mapping')
    base = f"/data/datasets/{record['datasetId']}/layers/seg"
    bigint = lambda v: {'customJsonEncoding': 'bigint', 'value': str(v)}
    cases = []

    def add(name, path, method='GET', body=None, query=None, **extra):
        # Agglomerate skeletons carry generation timestamps; compare everything else.
        compare = ('skeleton-proto' if '/skeleton/' in path else 'image' if 'Thumbnail' in path
                   else 'stl' if path.endswith('.stl') else 'auto')
        case = {'name': 'att-' + name, 'path': path if path.startswith('/data/') else base + path, 'method': method,
                'compare': compare, 'query_env': {'token': 'WK_REPLAY_TOKEN'}, **extra}
        if body is not None:
            case['json'] = body
        if query:
            case['query'] = query
        cases.append(case)

    for listing in ('agglomerates', 'meshes', 'mappings', 'hasSegmentIndex'):
        add(listing, '/' + listing)
    for mapping in ('agg', 'real100'):
        add(f'{mapping}-largest', f'/agglomerates/{mapping}/largestAgglomerateId')
        for agglomerate in (1, 2, 3, 5, 99):
            add(f'{mapping}-skeleton-{agglomerate}', f'/agglomerates/{mapping}/skeleton/{agglomerate}')
            add(f'{mapping}-graph-{agglomerate}', f'/agglomerates/{mapping}/agglomerateGraph/{agglomerate}')
        for segment in (1, 2, 3, 6):
            add(f'{mapping}-position-{segment}', f'/agglomerates/{mapping}/positionForSegment', query={'segmentId': str(segment)})
        add(f'{mapping}-data', '/data', 'POST', [{'position': [0, 0, 0], 'mag': [1, 1, 1], 'cubeSize': 32,
                                                  'applyAgglomerate': mapping}])
        for segments in ([1, 2, 3, 5, 99], [], [2**63 - 1]):
            add(f'{mapping}-for-segments-{len(segments)}', f'/agglomerates/{mapping}/agglomeratesForSegments', 'POST',
                body_hex=list_of_long(segments))
        add(f'{mapping}-thumbnail', '/layerThumbnail', query={'x': '0', 'y': '0', 'z': '0', 'width': '16',
                                                             'height': '16', 'mag': '1-1-1', 'mappingName': mapping})
    add('for-segments-bad-proto', '/agglomerates/agg/agglomeratesForSegments', 'POST', body_hex='0aff')
    for mapping in ('classes', 'broken', 'notes', 'missing'):
        add(f'mapping-json-{mapping}', f'/mappings/{mapping}')
    for mesh, segments in (('local', (1, 2, 2**64 - 1)), ('gzip', (1, 2, 2**64 - 1)), ('zarr', (1, 2, 2**64 - 1)),
                           ('real', (11, 30, 33, 2))):
        for segment in segments:
            add(f'mesh-{mesh}-chunks-{segment}', '/meshes/chunks', 'POST', {'meshFileName': mesh, 'segmentId': bigint(segment)})
            add(f'mesh-{mesh}-stl-{segment}', '/meshes/fullMesh.stl', 'POST', {'meshFileName': mesh, 'segmentId': bigint(segment)})
            # Byte ranges come from the (pair-compared) chunk listing at replay time; see run_live_replay.
            add(f'mesh-{mesh}-data-{segment}', '/meshes/chunks/data', 'POST', {'meshFileName': mesh, 'requests': []},
                derive_chunk_data=f'att-mesh-{mesh}-chunks-{segment}')
    add('mesh-data-bad-offset', '/meshes/chunks/data', 'POST',
        {'meshFileName': 'local', 'requests': [{'byteOffset': 2**40, 'byteSize': 16}]})
    add('mesh-data-unknown-file', '/meshes/chunks/data', 'POST',
        {'meshFileName': 'absent', 'requests': [{'byteOffset': 0, 'byteSize': 16}]})
    ad_hoc = {'position': [0, 0, 0], 'mag': [1, 1, 1], 'cubeSize': [17, 17, 17], 'voxelSizeFactorInUnit': [11.24, 11.24, 28]}
    for name, extra in (('seg1', {'segmentId': 1}), ('seg5', {'segmentId': 5}), ('absent', {'segmentId': 99}),
                        ('offset', {'segmentId': 3, 'position': [8, 16, 0]}),
                        ('json-classes', {'segmentId': 1, 'mapping': 'classes', 'mappingType': 'JSON'}),
                        ('json-broken', {'segmentId': 1, 'mapping': 'broken', 'mappingType': 'JSON'}),
                        ('hdf5-agg', {'segmentId': 1, 'mapping': 'agg', 'mappingType': 'HDF5'}),
                        ('bigint', {'segmentId': bigint(2**64 - 1)}), ('mag2', {'segmentId': 1, 'mag': [2, 2, 2]}),
                        ('outside', {'segmentId': 1, 'position': [64, 0, 0]})):
        add(f'ad-hoc-{name}', '/adHocMesh', 'POST', {**ad_hoc, **extra})
    add('statistics-file', '/segmentStatisticsFile')
    thumbnail_layer = {'dataLayerName': 'seg', 'x': 0, 'y': 0, 'z': 0, 'mag': '1-1-1', 'width': 16, 'height': 16,
                       'opacity': 1.0}
    for name, layers, mode in (('seg', [thumbnail_layer], 'Additive'),
                               ('seg-agg', [{**thumbnail_layer, 'mappingName': 'agg', 'opacity': 0.5}], 'Cover'),
                               ('missing-layer', [{**thumbnail_layer, 'dataLayerName': 'absent'}], 'Additive')):
        add(f'dataset-thumbnail-{name}', f"/data/datasets/{record['datasetId']}/datasetThumbnail", 'POST',
            {'width': 16, 'height': 16, 'layers': layers, 'blendMode': mode})
    proxy = f"/data/datasets/{record['datasetId']}/proxy/layers/seg"
    for name, suffix, headers in (('zarray', '/mags/1-1-1/.zarray', {}), ('chunk', '/mags/1-1-1/0.0.0', {}),
                                  ('chunk-range', '/mags/1-1-1/0.0.0', {'Range': 'bytes=16-47'}),
                                  ('chunk-suffix-range', '/mags/1-1-1/0.0.0', {'Range': 'bytes=-8'}),
                                  ('chunk-open-range', '/mags/1-1-1/0.0.0', {'Range': 'bytes=32760-'}),
                                  ('chunk-bad-range', '/mags/1-1-1/0.0.0', {'Range': 'bytes=99999-'}),
                                  ('missing-file', '/mags/1-1-1/9.9.9', {}), ('unknown-mag', '/mags/2-2-2/.zarray', {}),
                                  ('bad-mag', '/mags/one/.zarray', {}),
                                  ('mesh-zarr', '/attachments/mesh/zarr/zarr.json', {}),
                                  ('mesh-zarr-range', '/attachments/mesh/zarr/zarr.json', {'Range': 'bytes=0-9'}),
                                  ('mesh-zarr-missing', '/attachments/mesh/zarr/absent.json', {}),
                                  ('mesh-hdf5-below-file', '/attachments/mesh/local/x', {'Range': 'bytes=0-7'}),
                                  ('agglomerate-below-file', '/attachments/agglomerate/agg/x', {}),
                                  ('unknown-attachment', '/attachments/mesh/absent/zarr.json', {}),
                                  ('plural-attachment-type', '/attachments/meshes/zarr/zarr.json', {}),
                                  ('unknown-attachment-type', '/attachments/bogus/zarr/zarr.json', {})):
        add('proxy-' + name, proxy + suffix, **({'headers': headers} if headers else {}))
    segments = [1459063, 1447695, 1470463, 1, 4]
    for segment in segments:
        add(f'index-{segment}', f'/segmentIndex/{segment}', 'POST', {'mag': [1, 1, 1], 'cubeSize': [32, 32, 32]})
    add('index-batch', '/segmentIndex', 'POST', {'segmentIds': segments, 'mag': [1, 1, 1], 'cubeSize': [32, 32, 32]})
    for metric in ('volume', 'boundingBox', 'surfaceArea', 'covarianceMatrix', 'maxDistance', 'centerOfMass', 'sphericity'):
        add(f'stats-{metric}', f'/segmentStatistics/{metric}', 'POST', {'mag': [1, 1, 1], 'segmentIds': segments})
        if metric in ('volume', 'boundingBox'):
            # The real-world index references buckets far outside this 32^3 layer (like a cropped bbox).
            cases[-1]['declared_divergence'] = {
                'reason': 'Scala handleMultipleBucketRequests/loadMultiple throws IllegalArgumentException for '
                          'segment-index buckets outside the layer (e.g. after cropping the bbox) and fails the '
                          'statistic; Rust reads them as zeros', 'differences': ['status', 'body'], 'unverified': True}
    java_text = ('same status; the error message is the Java exception text of the Scala HDF5 reader '
                 '(ArrayIndexOutOfBounds / jhdf offset check) vs the Rust reader wording')
    declared = {
        'att-agg-for-segments-5': java_text, 'att-agg-for-segments-1': java_text,
        'att-real100-for-segments-1': java_text,
        'att-ad-hoc-json-broken': 'same status; malformed JSON mapping file: Gson parse error text vs serde_json',
    }
    for case in cases:
        if case['name'] in declared:
            case['declared_divergence'] = {'reason': declared[case['name']], 'differences': ['body'], 'unverified': True}
        if case['name'] == 'att-mappings':
            case['compare'] = 'json-set'  # Scala exploreMappings returns a Set
    write_json(output / 'pair-corpus.json', {'version': 1, 'cases': cases})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/wk-ds6-fixtures'))
    parser.add_argument('--attachments', action='store_true', help='Include twelve native HDF5/Zarr3 connectome HTTP cases')
    parser.add_argument('--bench', action='store_true', help='Include two 512x512x256 load-phase datasets')
    args = parser.parse_args()
    output = args.output.resolve()
    if not str(output).startswith(('/private/tmp/', '/tmp/')):
        parser.error('output must be under /tmp')
    if output.exists():
        parser.error('output already exists; choose a new immutable root')
    output.mkdir(parents=True)
    catalog = build(output, args.attachments, args.bench)
    print(json.dumps({'root': str(output), 'datasets': len(catalog.datasets), 'cases': len(catalog.cases),
                      'divergences': len(catalog.divergences)}))


if __name__ == '__main__':
    main()
