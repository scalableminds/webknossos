"""Breadth corpus: every read-only metadata/streaming/analysis GET route for every catalog dataset.

Pair comparison only (no independent goldens): it shows where Scala and Rust disagree, not that
either is right. The readData corpus with goldens covers voxel correctness.
"""

TOKEN = {'token': 'WK_REPLAY_TOKEN'}

VOXEL_ROUTES = ('histogram', 'raw-get', 'knossos-bucket', 'thumbnail', 'zarr2-layer-cube', 'zarr3-layer-cube-dots')
SEG32 = 'Scala ByteUtils.intToBytes shifts by 4 instead of 8 bits for uint32 compressed segmentation (bits32 also ' \
        'hits the full-width index mask bug); every voxel route inherits it'
OUT_OF_BBOX = ('Scala fails an aligned bucket fully outside the bbox once the clamped chunk was cached via the '
               'full-chunk shortcut (cache-history dependent, datastore-cutover.md DC1c); Rust zero-fills')
JPEG = 'Java ImageIO vs pure-Rust JPEG IDCT rounding (max 1 level in voxels, 2 after thumbnail re-encoding)'
# (dataset name, route suffixes, allowed differences, reason). Exact per-case lists, so a new
# difference elsewhere still fails and a fixed one fails as declared_divergence_resolved.
DECLARED = [
    ('compressed-segmentation-seg32', ('raw-get', 'knossos-bucket', 'zarr2-layer-cube', 'zarr3-layer-cube-dots'),
     ['body'], SEG32),
    ('compressed-segmentation-bits32', VOXEL_ROUTES, ['body', 'image'], SEG32),
    ('jpeg-gray-baseline', VOXEL_ROUTES, ['body', 'image'], JPEG),
    ('jpeg-gray-progressive', VOXEL_ROUTES, ['body', 'image'], JPEG),
    ('compressed-segmentation-seg64', ('thumbnail',), ['image'],
     'Scala ImageCreator.normalizeIntensityUint64 adds 0x8000000000000000L.toDouble (= -2^63), so uint64 values '
     '>= 2^63 turn negative and render black; Rust maps them unsigned (histogram range 0..2^64 -> 128)'),
    ('zip-zarr2-http', VOXEL_ROUTES + ('find-data', 'zarr2-layer-cube-2', 'proxy-mags-info'),
     ['status', 'header:content-type', 'header:failure-bucket-indices', 'header:missing-buckets', 'body', 'image'],
     'Scala Play withHttpHeaders drops X-Auth-Token on ranged remote ZIP reads (403), so data routes fail or zero-fill'),
    ('n5-gzip', ('find-data', 'histogram'), ['body'],
     'Scala FindDataService uses handleDataRequest without bbox clipping, so it samples voxels outside the layer '
     'bbox (and reports a bucket-aligned position outside it); Rust clips to the bbox. Open decision'),
    ('attachments-seg', ('thumbnail',), ['image'],
     'JPEG encoders (Java ImageIO vs jpeg-encoder) differ in chroma at segment colour edges; grey thumbnails decode '
     'pixel-identical'),
    ('attachments-seg', ('zarr2-layer-cube-2',), ['status', 'header:content-type', 'body'], OUT_OF_BBOX),
    ('connectome-attachments', ('zarr2-layer-cube-2',), ['status', 'header:content-type', 'body'],
     'Scala fails an aligned bucket fully outside the bbox once the clamped chunk was cached via the full-chunk '
     'shortcut (cache-history dependent, datastore-cutover.md DC1c); Rust zero-fills'),
]


def layer_cases(dataset_id, short, layer):
    base = f'/data/datasets/{dataset_id}/layers/{layer}'
    yield f'{short}-find-data', base + '/findData', {}
    yield f'{short}-histogram', base + '/histogram', {}
    yield f'{short}-thumbnail', base + '/layerThumbnail', {'x': '0', 'y': '0', 'z': '0', 'width': '16',
                                                         'height': '16', 'mag': '1-1-1'}
    yield f'{short}-raw-get', base + '/data', {'x': '0', 'y': '0', 'z': '0', 'width': '4', 'height': '4',
                                              'depth': '4', 'mag': '1-1-1'}
    yield f'{short}-knossos-bucket', base + '/mag1/x0/y0/z0/bucket.raw', {'cubeSize': '32'}
    for listing in ('mappings', 'agglomerates', 'meshes', 'connectomes', 'hasSegmentIndex'):
        yield f'{short}-{listing}', f'{base}/{listing}', {}
    yield f'{short}-proxy-mags-info', f'/data/datasets/{dataset_id}/proxy/layers/{layer}/mags/info', {}
    zarr = f'/data/zarr/{dataset_id}/{layer}'
    for suffix, name in (('', 'dir'), ('/.zattrs', 'zattrs'), ('/.zgroup', 'zgroup'), ('/1', 'mag-dir'),
                         ('/1/.zarray', 'zarray'), ('/1/0.0.0.0', 'cube'), ('/1/0.1.0.0', 'cube-2')):
        yield f'{short}-zarr2-layer-{name}', zarr + suffix, {}
    zarr3 = f'/data/zarr3/{dataset_id}/{layer}'
    for suffix, name in (('', 'dir'), ('/zarr.json', 'json'), ('/1', 'mag-dir'), ('/1/zarr.json', 'mag-json'),
                         ('/1/c.0.0.0.0', 'cube'), ('/1/0.0.0.0', 'cube-dots')):
        yield f'{short}-zarr3-layer-{name}', zarr3 + suffix, {}


def dataset_cases(record):
    dataset_id, short = record['datasetId'], record['dataSource']['id']['name']
    yield f'{short}-proxy-datasource', f'/data/datasets/{dataset_id}/proxy/datasource-properties.json', {}
    for flavor in ('zarr', 'zarr3', 'zarr3_experimental'):
        tag = flavor.replace('_', '-')
        yield f'{short}-{tag}-root', f'/data/{flavor}/{dataset_id}', {}
        yield f'{short}-{tag}-root-slash', f'/data/{flavor}/{dataset_id}/', {}
        yield f'{short}-{tag}-datasource', f'/data/{flavor}/{dataset_id}/datasource-properties.json', {}
    yield f'{short}-zarr2-zgroup', f'/data/zarr/{dataset_id}/.zgroup', {}
    for layer in record['dataSource']['dataLayers']:
        yield from layer_cases(dataset_id, short + '-' + layer['name'], layer['name'])


def declaration(dataset, name):
    for declared_dataset, routes, differences, reason in DECLARED:
        if dataset == declared_dataset and any(name.endswith('-' + route) for route in routes):
            # Pair comparison only: neither side has an independent oracle here.
            return {'reason': reason, 'differences': differences, 'unverified': True}
    return None


def breadth_document(catalog, declared=True):
    cases = []
    for record in catalog['datasets']:
        dataset = record['dataSource']['id']['name']
        for name, path, query in dataset_cases(record):
            # Scala exploreMappings returns a Set (unspecified order); Rust sorts.
            compare = 'image' if name.endswith('-thumbnail') else 'json-set' if name.endswith('-mappings') else 'auto'
            case = {'name': name[:80], 'path': path, 'query_env': dict(TOKEN), 'compare': compare}
            if query:
                case['query'] = query
            divergence = declaration(dataset, name) if declared else None
            if divergence:
                case['declared_divergence'] = divergence
            cases.append(case)
    return {'version': 1, 'cases': cases, 'declared_differences': {
        'error-chain': 'same status and error message; only the debug cause chain differs (Java exception class/'
                       'message text such as ArrayIndexOutOfBounds, HDF5JavaException, native Draco errors)'}}
