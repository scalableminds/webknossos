"""Load phase of run_live_replay.py: frontend-like requests against the generated bench datasets.

Uses `oha` (cargo install oha --locked). Per scenario: a correctness check (both sides answer the
first request identically; single buckets also against an independent formula oracle), then per
side a warmup and measured runs per concurrency level. Sides alternate per scenario so neither
always runs second. Records requests/s, latency percentiles, non-200 answers, CPU seconds and RSS.
Loopback on one machine: client and both servers share the CPU, so compare relative numbers only.
"""
import json
import random
import subprocess
import urllib.request

BUCKET = 32
SHAPE = (512, 512, 256)  # generate_fixture_catalog.BENCH_SHAPE


def voxel(x, y, z):
    """The generator's formula: structured base chunk value shifted per chunk index."""
    bx, by, bz = x % BUCKET, y % BUCKET, z % BUCKET
    base = (bx * 7 + by * 3 + bz * 5 + ((bx * by) >> 4)) & 255
    return (base + (x // BUCKET) * 11 + (y // BUCKET) * 13 + (z // BUCKET) * 17) & 255


def bucket_oracle(position):
    x0, y0, z0 = position
    return bytes(voxel(x0 + x, y0 + y, z0 + z) for z in range(BUCKET) for y in range(BUCKET) for x in range(BUCKET))


def random_bucket(rng):
    return [rng.randrange(SHAPE[i] // BUCKET) * BUCKET for i in range(3)]


def bodies(kind, rng, count=400):
    lines = []
    for _ in range(count):
        if kind == 'bucket':
            body = [{'position': random_bucket(rng), 'mag': [1, 1, 1], 'cubeSize': BUCKET}]
        elif kind == 'batch32':
            body = [{'position': random_bucket(rng), 'mag': [1, 1, 1], 'cubeSize': BUCKET} for _ in range(32)]
        else:  # readData 128^3 cuboid
            body = {'position': [rng.randrange(0, SHAPE[i] - 128) for i in range(3)], 'mag': [1, 1, 1],
                    'cubeSize': [128, 128, 128]}
        lines.append(json.dumps(body, separators=(',', ':')))
    return lines


def scenarios(catalog, token):
    ids = {d['dataSource']['id']['name']: d['datasetId'] for d in catalog['datasets']}
    z2, z3 = ids['bench-zarr2-zlib'], ids['bench-zarr3-gzip']
    q = '?token=' + token
    return [
        ('health', 'GET', '/data/health', None),
        ('bucket-zarr2', 'POST', f'/data/datasets/{z2}/layers/color/data{q}', 'bucket'),
        ('batch32-zarr2', 'POST', f'/data/datasets/{z2}/layers/color/data{q}', 'batch32'),
        ('batch32-zarr3', 'POST', f'/data/datasets/{z3}/layers/color/data{q}', 'batch32'),
        ('cuboid128-zarr2', 'POST', f'/data/datasets/{z2}/layers/color/readData{q}', 'cuboid'),
        # Zarr streaming chunk GETs at random chunk coordinates (oha --rand-regex-url).
        # oha's generator reads `\.` as any character; character classes stay literal.
        ('zarr-stream-cube', 'REGEX', f'/data/zarr/{z2}/color/1/0[.][0-9][.]1[0-5][.][0-7]' + q.replace('?', '[?]'), None),
        ('histogram-zarr2', 'GET', f'/data/datasets/{z2}/layers/color/histogram{q}', None),
    ]


def fetch(origin, method, path, body):
    request = urllib.request.Request(origin + path, data=body.encode() if body else None, method=method,
                                     headers={'Content-Type': 'application/json'} if body else {})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=60) as response:
        return response.status, dict(response.headers), response.read()


def check(name, method, path, kind, lines, scala, rust):
    """Both sides must agree on the first request; single buckets must match the formula oracle."""
    if method == 'REGEX':
        method, path = 'GET', (path.replace('[.]', '.').replace('[?]', '?').replace('[0-9]', '1')
                               .replace('1[0-5]', '12').replace('[0-7]', '3'))
    body = lines[0] if lines else None
    answers = {side: fetch(origin, method, path, body) for side, origin in (('scala', scala), ('rust', rust))}
    problems = []
    if any(status != 200 for status, _, _ in answers.values()):
        problems.append('status')
    if name != 'health' and answers['scala'][2] != answers['rust'][2]:
        problems.append('pair_body')
    if kind == 'bucket':
        oracle = bucket_oracle(json.loads(body)[0]['position'])
        problems += [f'oracle:{side}' for side, (_, _, data) in answers.items() if data != oracle]
    return problems


def process_sample(pid):
    out = subprocess.run(['ps', '-o', 'time=,rss=', '-p', str(pid)], capture_output=True, text=True).stdout.split()
    if len(out) != 2:
        return None, None
    parts = [float(p) for p in out[0].replace('-', ':').split(':')]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2], int(out[1])


def oha(binary, origin, method, path, body_file, concurrency, seconds):
    argv = [binary, '--no-tui', '--output-format', 'json', '-c', str(concurrency), '-z', f'{seconds}s']
    if method == 'REGEX':
        argv += ['--rand-regex-url', origin.replace('.', '[.]') + path]
    else:
        argv += ['-m', method, origin + path]
    if body_file:
        argv += ['-H', 'Content-Type: application/json', '-Z', str(body_file)]
    result = subprocess.run(argv, capture_output=True, text=True, timeout=seconds + 120)
    if result.returncode != 0:
        return {'error': 'oha_failed'}
    data = json.loads(result.stdout)
    latency = data.get('latencyPercentiles', {})
    statuses = data.get('statusCodeDistribution', {})
    return {'rps': round(data['summary']['requestsPerSec'], 1),
            **{k: round(latency[k] * 1000, 2) for k in ('p50', 'p95', 'p99') if latency.get(k) is not None},
            'mib_per_s': round(data['summary'].get('sizePerSec', 0) / 2 ** 20, 1),
            'requests': sum(statuses.values()), 'non_200': sum(v for k, v in statuses.items() if k != '200'),
            'errors': sum(data.get('errorDistribution', {}).values())}


def sampled(pid, seconds, target, measure):
    """macOS `sample` of one process while `measure()` runs (call-tree text in `target`)."""
    profiler = subprocess.Popen(['sample', str(pid), str(seconds), '-file', str(target)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        return measure()
    finally:
        profiler.wait(timeout=seconds + 60)


def run(binary, catalog, token, origins, pids, output, levels=(1, 8, 32), seconds=4, warmup=2, seed=7,
        profile=(), only=()):
    rng = random.Random(seed)
    directory = output / 'bench'
    directory.mkdir(mode=0o700)
    results = []
    chosen = [s for s in scenarios(catalog, token) if not only or s[0] in only]
    for index, (name, method, path, kind) in enumerate(chosen):
        lines = bodies(kind, rng) if kind else None
        body_file = None
        if lines:
            body_file = directory / f'{name}.bodies'
            body_file.write_text('\n'.join(lines) + '\n')
        entry = {'scenario': name, 'check': check(name, method, path, kind, lines, origins['scala'], origins['rust'])}
        order = ['scala', 'rust'] if index % 2 == 0 else ['rust', 'scala']
        for side in order:
            oha(binary, origins[side], method, path, body_file, 8, warmup)  # JIT, pools, caches
            cpu_before, _ = process_sample(pids[side])
            entry[side] = {}
            for level in levels:
                measure = lambda: oha(binary, origins[side], method, path, body_file, level, seconds)
                if name in profile and level == max(levels):
                    measure_now = measure
                    measure = lambda: sampled(pids[side], seconds - 1, directory / f'{name}.{side}.sample.txt',
                                              measure_now)
                entry[side][f'c{level}'] = measure()
            cpu_after, rss = process_sample(pids[side])
            entry[side]['cpu_seconds'] = round(cpu_after - cpu_before, 2) if cpu_before is not None else None
            entry[side]['rss_mib'] = round(rss / 1024, 1) if rss else None
        results.append(entry)
    return results


def markdown(results, levels=(1, 8, 32)):
    rows = ['| scenario | check | ' + ' | '.join(f'c{l} rps S / R' for l in levels) + ' | p99 c8 ms S / R | CPU s S / R | RSS MiB S / R |',
            '|---|---|' + '---|' * len(levels) + '---|---|---|']
    for e in results:
        s, r = e['scala'], e['rust']
        cells = [f"{s[f'c{l}'].get('rps')} / {r[f'c{l}'].get('rps')}" for l in levels]
        rows.append(f"| {e['scenario']} | {','.join(e['check']) or 'ok'} | " + ' | '.join(cells)
                    + f" | {s['c8'].get('p99')} / {r['c8'].get('p99')} | {s['cpu_seconds']} / {r['cpu_seconds']}"
                    + f" | {s['rss_mib']} / {r['rss_mib']} |")
    return '\n'.join(rows) + '\n'
