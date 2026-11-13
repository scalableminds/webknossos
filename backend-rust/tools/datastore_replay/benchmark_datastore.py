#!/usr/bin/env python3
"""Bounded HTTP load check with independent byte goldens; not a production benchmark."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import time

spec = importlib.util.spec_from_file_location('replay', Path(__file__).parents[1] / 'datastore_differential_replay.py')
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]


def benchmark(origin, case, side, requests, concurrency, warmups, timeout):
    expected = case['expected_sha256'].get(side)
    if not expected or case['expected_status'] != 200:
        raise ValueError('benchmark requires an independent expected200 byte golden for this side')

    def one(_):
        response = replay.fetch(origin, case, timeout, 64 * 1024 * 1024)
        body = response.get('body', b'')
        valid = response.get('status') == 200 and hashlib.sha256(body).hexdigest() == expected
        return {'ms': response['ms'], 'bytes': len(body), 'valid': valid}

    # Warmup verification is required, not counted toward measured throughput.
    for _ in range(warmups):
        if not one(None)['valid']:
            return {'passed': False, 'error': 'warmup_golden_mismatch'}
    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        responses = list(pool.map(one, range(requests)))
    seconds = time.perf_counter() - start
    times = [r['ms'] for r in responses]
    return {
        'passed': all(r['valid'] for r in responses),
        'requests': requests, 'concurrency': concurrency, 'warmups': warmups,
        'golden_failures': sum(not r['valid'] for r in responses),
        'wall_seconds': seconds, 'requests_per_second': requests / seconds,
        'mib_per_second': sum(r['bytes'] for r in responses) / (1024 * 1024 * seconds),
        'p50_ms': percentile(times, 0.50), 'p95_ms': percentile(times, 0.95),
        'p99_ms': percentile(times, 0.99),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scala', required=True)
    parser.add_argument('--rust', required=True)
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--case', required=True)
    parser.add_argument('--requests', type=int, default=128)
    parser.add_argument('--concurrency', type=int, default=4)
    parser.add_argument('--warmups', type=int, default=8)
    parser.add_argument('--timeout', type=float, default=10)
    args = parser.parse_args(argv)
    try:
        if not 1 <= args.requests <= 10000 or not 1 <= args.concurrency <= 64 or not 1 <= args.warmups <= 100 or args.timeout <= 0:
            raise ValueError('bounded positive load settings required')
        cases = replay.prepare(json.loads(args.corpus.read_text()), {})
        chosen = [case for case in cases if case['name'] == args.case]
        if len(chosen) != 1:
            raise ValueError('exactly one benchmark case required')
        result = {'version': 1, 'case': args.case, 'scope': 'warm repeated loopback HTTP; client includes connection overhead',
                  'results': {side: benchmark(replay.base_url(origin), chosen[0], side, args.requests, args.concurrency, args.warmups, args.timeout)
                              for side, origin in [('scala', args.scala), ('rust', args.rust)]}}
        result['passed'] = all(r['passed'] for r in result['results'].values())
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'passed': False, 'error': 'invalid_benchmark_configuration'}))
        return 2
    print(json.dumps(result, indent=2))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
