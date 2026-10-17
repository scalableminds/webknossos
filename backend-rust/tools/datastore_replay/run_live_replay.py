#!/usr/bin/env python3
"""Run an isolated real Scala/Rust read replay; retain artifacts and all mismatches."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import datastore_differential_replay as differential
from datastore_replay.breadth import breadth_document
from datastore_replay import bench_phase, upload_phase


class HarnessFailure(Exception):
    pass


def derive_chunk_data(cases, origins, token):
    """Mesh `chunks/data` cases read the byte ranges of a chunk listing case (reversed, so not in
    listing order). The listing is fetched from both sides; if they disagree or fail, the data case
    keeps its empty request list and the listing case itself reports the difference."""
    by_name = {case['name']: case for case in cases}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for case in cases:
        source = case.pop('derive_chunk_data', None)
        if not source:
            continue
        listing = by_name[source]
        answers = []
        for origin in origins:
            request = urllib.request.Request(origin + listing['path'] + '?token=' + token, method='POST',
                                             data=json.dumps(listing['json']).encode(),
                                             headers={'Content-Type': 'application/json'})
            try:
                with opener.open(request, timeout=60) as response:
                    answers.append(response.read())
            except OSError:
                answers.append(None)
        if answers[0] is None or answers[0] != answers[1]:
            continue
        chunks = [chunk for lod in json.loads(answers[0])['lods'] for chunk in lod['chunks']][::-1]
        case['json']['requests'] = [{'byteOffset': chunk['byteOffset'], 'byteSize': chunk['byteSize'],
                                     'segmentId': listing['json']['segmentId']} for chunk in chunks]


def free_ports(count):
    sockets = []
    try:
        for _ in range(count):
            sock = socket.socket()
            sock.bind(('127.0.0.1', 0))
            sockets.append(sock)
        return [sock.getsockname()[1] for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


class Children:
    def __init__(self, output, env):
        self.output, self.env, self.records = output, env, []

    def start(self, name, argv, env=None, cwd=None):
        log = (self.output / (name + '.log')).open('wb')
        try:
            process = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT,
                                       env=env or self.env, cwd=cwd)
        finally:
            log.close()
        self.records.append((name, process))
        (self.output / 'processes.json').write_text(json.dumps([
            {'name': child_name, 'pid': child.pid} for child_name, child in self.records
        ], indent=2) + '\n')
        return process

    def command(self, name, argv, timeout=60):
        process = self.start(name, argv)
        try:
            if process.wait(timeout) != 0:
                raise HarnessFailure(name + '_failed')
        except subprocess.TimeoutExpired:
            raise HarnessFailure(name + '_timeout') from None

    def alive(self, services):
        if any(process.poll() is not None for process in services):
            raise HarnessFailure('service_exited')

    def stop(self):
        # Drain datastore children while fixture/Redis dependencies remain available.
        for _, process in reversed(self.records):
            if process.poll() is None:
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
            try:
                process.wait(40)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        return [{'name': name, 'exit_status': process.returncode}
                for name, process in self.records]

    def rss(self):
        result = {}
        for name, process in self.records:
            if process.poll() is None:
                sample = subprocess.run(['ps', '-o', 'rss=', '-p', str(process.pid)],
                                        capture_output=True, text=True, timeout=5)
                value = sample.stdout.strip()
                if value.isdecimal():
                    result[name] = int(value)
        return result


def probe(origin, path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(origin + path, timeout=1) as response:
        return response.status, response.read(1024 * 1024)


def ready(children, services, origin, deadline):
    while time.monotonic() < deadline:
        children.alive(services)
        try:
            status, body = probe(origin, '/data/health')
            if status == 200 and body == b'Ok':
                children.alive(services)
                return
        except (OSError, ValueError):
            pass
        time.sleep(.2)
    raise HarnessFailure('readiness_timeout')


def contract_document(catalog):
    records = [record for record in catalog['datasets']
               if record['dataSource']['id']['name'] == 'zarr2-raw']
    if len(records) != 1:
        raise HarnessFailure('contract_dataset_not_unique')
    record = records[0]
    document = json.loads((HERE / 'dataset.template.json').read_text())
    health = json.loads((HERE / 'health.json').read_text())['cases'][0]
    document['cases'].append(health)
    aliases = [case for case in document['cases'] if case['name'] in ('raw-cuboid', 'metadata', 'health')]
    for version in (10, 14, 16):
        for case in aliases:
            alias = json.loads(json.dumps(case))
            alias['name'] += '-v' + str(version)
            alias['path'] = alias['path'].replace('/data/', '/data/v' + str(version) + '/', 1)
            document['cases'].append(alias)
    return document, {'dataset': record['datasetId'], 'layer': record['dataSource']['dataLayers'][0]['name']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    scala_source = parser.add_mutually_exclusive_group(required=True)
    scala_source.add_argument('--artifacts-root', type=Path)
    scala_source.add_argument('--stage-lib', type=Path)
    parser.add_argument('--java', default='java')
    parser.add_argument('--source-root', type=Path, default=HERE.parents[2])
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--redis-binary', default='redis-server')
    parser.add_argument('--rounds', default=3, type=int)
    parser.add_argument('--startup-timeout', default=90, type=float)
    parser.add_argument('--request-timeout', default=15, type=float)
    parser.add_argument('--extra-corpus', type=Path, action='append', default=[],
                        help='additional corpus replayed with the contract variables (dataset/layer of zarr2-raw); '
                             'its report goes to <output>/extra-<n>-report.json and counts towards the result')
    parser.add_argument('--breadth', action='store_true',
                        help='also replay the generated breadth corpus (metadata/streaming/analysis GET routes for '
                             'every dataset; pair comparison only); report in <output>/breadth-report.json')
    parser.add_argument('--bench', action='store_true',
                        help='after the replays, run the load phase (bench_phase.py) on generated 512x512x256 datasets; '
                             'results in <output>/bench.json and bench.md')
    parser.add_argument('--uploads', action='store_true',
                        help='after the replays, run the upload phase (upload_phase.py: reserve/chunk/finish/cancel '
                             'sequences; answers, Redis, files and WK calls compared); <output>/upload-report.json')
    parser.add_argument('--oha', default='/tmp/wk-diff/tools/bin/oha', help='oha binary for --bench')
    parser.add_argument('--profile', default='', help='comma-separated bench scenarios to sample (macOS `sample`) '
                                                       'during the highest concurrency run; <output>/bench/*.sample.txt')
    parser.add_argument('--bench-scenarios', default='', help='comma-separated subset of bench scenarios')
    parser.add_argument('--only-extra', action='store_true',
                        help='replay only the --extra-corpus documents against freshly started services (cold caches)')
    parser.add_argument('--dump-mismatches', action='store_true',
                        help='save both sides\' headers and bodies of mismatching cases (first round) to '
                             '<output>/dumps for diagnosis; may contain test-only token echoes')
    args = parser.parse_args(argv)
    output = args.output.resolve()
    temp = Path('/tmp').resolve()
    if output == temp or not output.is_relative_to(temp) or output.exists():
        parser.error('output must be a new directory below /tmp')
    if not args.binary.resolve().is_file() or not os.access(args.binary, os.X_OK):
        parser.error('binary must be an existing executable')
    if args.rounds < 1 or args.startup_timeout <= 0 or args.request_timeout <= 0:
        parser.error('rounds and timeouts must be positive')
    output.mkdir(parents=True)
    output.chmod(0o700)
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('WK_DS_', 'WK_REPLAY_', 'AWS_', 'GOOGLE_'))
           and not key.lower().endswith('_proxy')}
    env.update(WK_REPLAY_TOKEN=secrets.token_urlsafe(24),
               WK_REPLAY_TOKEN_SECOND=secrets.token_urlsafe(24),
               WK_REPLAY_DENIED_TOKEN=secrets.token_urlsafe(24),
               WK_REPLAY_FIXTURE_KEY=secrets.token_urlsafe(32),
               # Each datastore has its own WK key, so the fixture can keep upload RPCs per side.
               WK_REPLAY_FIXTURE_KEY_RUST=secrets.token_urlsafe(32))
    children = Children(output, env)
    summary = {'version': 1, 'passed': False, 'rounds': args.rounds}
    started = time.monotonic()
    report = None
    def interrupted(*_):
        raise InterruptedError()
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        fixtures = output / 'fixtures'
        children.command('generate', [sys.executable, str(HERE / 'generate_fixture_catalog.py'),
                                     '--attachments', *(['--bench'] if args.bench else []), '--output', str(fixtures)])
        corpus = json.loads((fixtures / 'corpus.json').read_text())
        summary['cases'] = len(corpus['cases'])
        if summary['cases'] < 41:
            raise HarnessFailure('incomplete_fixture_corpus')
        fixture = children.start('fixture', [sys.executable, str(HERE / 'fixture_server.py'),
            '--root', str(fixtures), '--catalog', str(fixtures / 'catalog.json'), '--port', '0',
            '--token-env', 'WK_REPLAY_TOKEN', '--token-env', 'WK_REPLAY_TOKEN_SECOND'])
        deadline = time.monotonic() + args.startup_timeout
        fixture_origin = None
        while time.monotonic() < deadline:
            children.alive([fixture])
            lines = (output / 'fixture.log').read_text().splitlines()
            if lines:
                value = json.loads(lines[0])
                if not value.get('ready'):
                    raise HarnessFailure('fixture_not_ready')
                fixture_origin = value['origin']
                break
            time.sleep(.1)
        if not fixture_origin or not fixture_origin.startswith('http://127.0.0.1:'):
            raise HarnessFailure('invalid_fixture_origin')
        wk_port = int(fixture_origin.rsplit(':', 1)[1])
        scala_port, rust_port, redis_port, rust_redis_port = free_ports(4)
        (output / 'ports.json').write_text(json.dumps({
            'scala': scala_port, 'rust': rust_port, 'redis': redis_port, 'redis-rust': rust_redis_port,
            'fixture': wk_port
        }, indent=2) + '\n')
        # One Redis and one upload base directory per side: upload metadata and files stay comparable.
        # The upload root is organization-agnostic and second: an organization-specific entry would take
        # precedence for every organization lookup (JSON mappings) and hide the fixture datasets.
        redis_processes = []
        for name, port in (('redis', redis_port), ('redis-rust', rust_redis_port)):
            redis_dir = output / name
            redis_dir.mkdir()
            redis_processes.append(children.start(name, [args.redis_binary, '--bind', '127.0.0.1',
                '--port', str(port), '--dir', str(redis_dir), '--save', '', '--appendonly', 'no']))
        upload_roots = {side: output / 'uploads' / side for side in ('scala', 'rust')}
        for root in upload_roots.values():
            root.mkdir(parents=True)
        scala_dir = output / 'scala'
        scala_classpath = (['--stage-lib', str(args.stage_lib.resolve())] if args.stage_lib
                           else ['--artifacts-root', str(args.artifacts_root.resolve())])
        children.command('prepare', [sys.executable, str(HERE / 'prepare_scala.py'), *scala_classpath,
            '--java', args.java, '--source-root', str(args.source_root.resolve()),
            '--output', str(scala_dir), '--port', str(scala_port), '--redis-port', str(redis_port),
            '--wk-port', str(wk_port), '--datastore-name', 'replay-ds', '--data-root', str(fixtures / 'datasets'),
            '--key-env', 'WK_REPLAY_FIXTURE_KEY', '--upload-root', str(upload_roots['scala'])])
        # Remote current-user-token range fixture deliberately shares public authority with WK.
        with (scala_dir / 'isolated.conf').open('a') as stream:
            stream.write('\nhttp.uri = ' + json.dumps(fixture_origin) + '\n')
        scala = children.start('scala', json.loads((scala_dir / 'launch-command.json').read_text()),
                               cwd=scala_dir)
        rust_env = dict(env, RUST_LOG='info', WK_DS_HTTP_ADDRESS='127.0.0.1', WK_DS_HTTP_PORT=str(rust_port),
            WK_DS_HTTP_URI=fixture_origin, WK_DS_KEY=env['WK_REPLAY_FIXTURE_KEY_RUST'], WK_DS_NAME='replay-ds',
            WK_DS_WEBKNOSSOS_URI=fixture_origin, WK_DS_REDIS_ADDRESS='127.0.0.1', WK_DS_REDIS_PORT=str(rust_redis_port),
            WK_DS_BASE_DIRECTORIES=json.dumps([{'path': str(fixtures / 'datasets'), 'organizationId': None,
                                               'allowsUpload': False, 'doScan': False},
                                              {'path': str(upload_roots['rust']), 'organizationId': None,
                                               'allowsUpload': True, 'doScan': False}]),
            WK_DS_WATCH_FILE_SYSTEM_ENABLED='false', WK_DS_DATA_VAULTS_CREDENTIALS='[]',
            WK_DS_LOCAL_DIRECTORY_WHITELIST='[]', WK_DS_SLACK_NOTIFICATIONS_URI='',
            WK_DS_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED='false', WK_DS_WRITE_VIRTUAL_DATASETS_MIRROR='false')
        rust = children.start('rust', [str(args.binary.resolve())], env=rust_env, cwd=output)
        services = [fixture, *redis_processes, scala, rust]
        ready(children, services, 'http://127.0.0.1:' + str(scala_port), deadline)
        ready(children, services, 'http://127.0.0.1:' + str(rust_port), deadline)
        summary['ready'] = True
        summary['rss_kib_before'] = children.rss()
        # The existing preparation API resolves secrets from process environment.
        saved = {key: os.environ.get(key) for key in env if key.startswith('WK_REPLAY_')}
        try:
            os.environ.update({key: env[key] for key in saved})
            cases = differential.prepare(corpus, {})
            contract, variables = contract_document(json.loads((fixtures / 'catalog.json').read_text()))
            contract_cases = differential.prepare(contract, variables)
            breadth = breadth_document(json.loads((fixtures / 'catalog.json').read_text())) if args.breadth else None
            if breadth and (fixtures / 'pair-corpus.json').exists():
                # Attachment routes (agglomerates, meshes, segment index/statistics): pair comparison too.
                breadth['cases'] += json.loads((fixtures / 'pair-corpus.json').read_text())['cases']
                derive_chunk_data(breadth['cases'], ['http://127.0.0.1:' + str(port) for port in (scala_port, rust_port)],
                                  env['WK_REPLAY_TOKEN'])
            breadth_cases = differential.prepare(breadth, {}) if breadth else []
            if breadth:
                (output / 'breadth-corpus.json').write_text(json.dumps(breadth, indent=2) + '\n')
            extra_cases = [differential.prepare(json.loads(path.read_text()), variables) for path in args.extra_corpus]
            (output / 'contract-corpus.json').write_text(json.dumps(contract, indent=2) + '\n')
        finally:
            for key, old in saved.items():
                if old is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = old
        dumps = None
        if args.dump_mismatches:
            dumps = output / 'dumps'
            dumps.mkdir(mode=0o700)
        if args.only_extra:
            cases, contract_cases = cases[:0], contract_cases[:0]
        report = differential.replay('http://127.0.0.1:' + str(scala_port),
                                     'http://127.0.0.1:' + str(rust_port), cases,
                                     args.rounds, args.request_timeout, dump_dir=dumps)
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        children.alive(services)
        summary['rss_kib_after'] = children.rss()
        summary['passed'] = report['passed']
        summary['mismatch_categories'] = dict(Counter(
            difference for result in report['results'] for difference in result['differences']))
        summary['mismatch_cases'] = sorted({result['case'] for result in report['results'] if result['differences']})
        summary['declared_cases'] = sorted({result['case'] for result in report['results'] if result.get('declared_differences')})
        contract_report = differential.replay('http://127.0.0.1:' + str(scala_port),
            'http://127.0.0.1:' + str(rust_port), contract_cases, args.rounds, args.request_timeout,
            dump_dir=dumps)
        (output / 'contract-report.json').write_text(json.dumps(contract_report, indent=2) + '\n')
        children.alive(services)
        summary['contract'] = {
            'cases': len(contract_cases), 'passed': contract_report['passed'],
            'mismatch_categories': dict(Counter(d for result in contract_report['results'] for d in result['differences'])),
            'mismatch_cases': sorted({result['case'] for result in contract_report['results'] if result['differences']})}
        summary['passed'] = summary['passed'] and contract_report['passed']
        if breadth_cases:
            breadth_report = differential.replay('http://127.0.0.1:' + str(scala_port),
                'http://127.0.0.1:' + str(rust_port), breadth_cases, args.rounds, args.request_timeout,
                dump_dir=dumps)
            (output / 'breadth-report.json').write_text(json.dumps(breadth_report, indent=2) + '\n')
            children.alive(services)
            first = [r for r in breadth_report['results'] if r['round'] == 0]
            summary['breadth'] = {
                'cases': len(breadth_cases), 'passed': breadth_report['passed'],
                'mismatch_categories': dict(Counter(d for r in breadth_report['results'] for d in r['differences'])),
                'mismatch_cases': sorted({r['case'] for r in breadth_report['results'] if r['differences']}),
                # Equal non-2xx answers pass the pair comparison; list them so they get looked at.
                'status_counts': dict(Counter(f"{r['scala'].get('status')}/{r['rust'].get('status')}" for r in first))}
            summary['passed'] = summary['passed'] and breadth_report['passed']
        summary['extra'] = []
        for index, cases_of_extra in enumerate(extra_cases):
            extra_report = differential.replay('http://127.0.0.1:' + str(scala_port),
                'http://127.0.0.1:' + str(rust_port), cases_of_extra, args.rounds, args.request_timeout,
                dump_dir=dumps)
            (output / f'extra-{index}-report.json').write_text(json.dumps(extra_report, indent=2) + '\n')
            children.alive(services)
            summary['extra'].append({
                'corpus': args.extra_corpus[index].name, 'cases': len(cases_of_extra), 'passed': extra_report['passed'],
                'mismatch_cases': sorted({r['case'] for r in extra_report['results'] if r['differences']})})
            summary['passed'] = summary['passed'] and extra_report['passed']
        if args.uploads:
            uploads = upload_phase.run(
                {'scala': 'http://127.0.0.1:' + str(scala_port), 'rust': 'http://127.0.0.1:' + str(rust_port)},
                {'scala': redis_port, 'rust': rust_redis_port}, upload_roots, fixture_origin,
                {'primary': env['WK_REPLAY_TOKEN'], 'denied': env['WK_REPLAY_DENIED_TOKEN']})
            (output / 'upload-report.json').write_text(json.dumps(uploads, indent=2) + '\n')
            children.alive(services)
            summary['uploads'] = {key: (len(value) if key == 'steps' else value) for key, value in uploads.items()
                                  if key != 'wk_calls'}
            summary['passed'] = summary['passed'] and uploads['passed']
        summary['rss_kib_after'] = children.rss()
        if args.bench:
            pids = {name: process.pid for name, process in children.records if name in ('scala', 'rust')}
            bench = bench_phase.run(args.oha, json.loads((fixtures / 'catalog.json').read_text()),
                                    env['WK_REPLAY_TOKEN'], {'scala': 'http://127.0.0.1:' + str(scala_port),
                                                             'rust': 'http://127.0.0.1:' + str(rust_port)}, pids, output,
                                    profile=tuple(filter(None, args.profile.split(','))),
                                    only=tuple(filter(None, args.bench_scenarios.split(','))))
            (output / 'bench.json').write_text(json.dumps(bench, indent=2) + '\n')
            (output / 'bench.md').write_text(bench_phase.markdown(bench))
            children.alive(services)
            summary['bench_checks'] = {e['scenario']: e['check'] for e in bench}
            summary['passed'] = summary['passed'] and not any(e['check'] for e in bench)
        status, counters = probe(fixture_origin, '/counters')
        if status != 200:
            raise HarnessFailure('counters_failed')
        (output / 'counters.json').write_bytes(counters)
    except HarnessFailure as error:
        summary['error'] = str(error)
    except InterruptedError:
        summary['error'] = 'interrupted'
    except Exception:
        # Logs retain child diagnostics; never print secret-bearing exception text.
        summary['error'] = 'harness_failure'
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        summary['children'] = children.stop()
        summary['elapsed_seconds'] = round(time.monotonic() - started, 3)
        (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary))
    return 2 if 'error' in summary else (0 if summary['passed'] else 1)


if __name__ == '__main__':
    raise SystemExit(main())
