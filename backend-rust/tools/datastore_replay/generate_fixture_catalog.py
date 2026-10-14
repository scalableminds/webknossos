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
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'datastore/tests/fixtures'
ORG = 'replay-org'


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

    def case(self, record, name, position, size, expected, endpoint='readData', divergence=None):
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
                    'datasets': self.datasets, 'remoteFiles': self.remote})
        write_json(self.output / 'corpus.json', {'version': 1, 'cases': self.cases})
        write_json(self.output / 'goldens.json', {'version': 1, 'cases': self.goldens, 'intentional_divergences': self.divergences})
        files = []
        for file in sorted(self.output.rglob('*')):
            if file.is_file():
                files.append({'path': str(file.relative_to(self.output)), 'length': file.stat().st_size, 'sha256': digest(file.read_bytes())})
        write_json(self.output / 'manifest.json', {'version': 1, 'files': files})


def build(output, attachments=False):
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
               divergence='Java ImageIO versus pure-Rust JPEG IDCT rounding differs by up to one gray level; strict default comparison retained')
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
    c.finish()
    return c


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/wk-ds6-fixtures'))
    parser.add_argument('--attachments', action='store_true', help='Include twelve native HDF5/Zarr3 connectome HTTP cases')
    args = parser.parse_args()
    output = args.output.resolve()
    if not str(output).startswith(('/private/tmp/', '/tmp/')):
        parser.error('output must be under /tmp')
    if output.exists():
        parser.error('output already exists; choose a new immutable root')
    output.mkdir(parents=True)
    catalog = build(output, args.attachments)
    print(json.dumps({'root': str(output), 'datasets': len(catalog.datasets), 'cases': len(catalog.cases),
                      'divergences': len(catalog.divergences)}))


if __name__ == '__main__':
    main()
