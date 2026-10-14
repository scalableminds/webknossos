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


class HarnessFailure(Exception):
    pass


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
    parser.add_argument('--artifacts-root', required=True, type=Path)
    parser.add_argument('--source-root', type=Path, default=HERE.parents[2])
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--redis-binary', default='redis-server')
    parser.add_argument('--rounds', default=3, type=int)
    parser.add_argument('--startup-timeout', default=90, type=float)
    parser.add_argument('--request-timeout', default=15, type=float)
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
               WK_REPLAY_FIXTURE_KEY=secrets.token_urlsafe(32))
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
                                     '--attachments', '--output', str(fixtures)])
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
        scala_port, rust_port, redis_port = free_ports(3)
        (output / 'ports.json').write_text(json.dumps({
            'scala': scala_port, 'rust': rust_port, 'redis': redis_port, 'fixture': wk_port
        }, indent=2) + '\n')
        redis_dir = output / 'redis'
        redis_dir.mkdir()
        redis = children.start('redis', [args.redis_binary, '--bind', '127.0.0.1',
            '--port', str(redis_port), '--dir', str(redis_dir), '--save', '', '--appendonly', 'no'])
        scala_dir = output / 'scala'
        children.command('prepare', [sys.executable, str(HERE / 'prepare_scala.py'),
            '--artifacts-root', str(args.artifacts_root.resolve()), '--source-root', str(args.source_root.resolve()),
            '--output', str(scala_dir), '--port', str(scala_port), '--redis-port', str(redis_port),
            '--wk-port', str(wk_port), '--datastore-name', 'replay-ds', '--data-root', str(fixtures / 'datasets'),
            '--key-env', 'WK_REPLAY_FIXTURE_KEY'])
        # Remote current-user-token range fixture deliberately shares public authority with WK.
        with (scala_dir / 'isolated.conf').open('a') as stream:
            stream.write('\nhttp.uri = ' + json.dumps(fixture_origin) + '\n')
        scala = children.start('scala', json.loads((scala_dir / 'launch-command.json').read_text()),
                               cwd=scala_dir)
        rust_env = dict(env, RUST_LOG='info', WK_DS_HTTP_ADDRESS='127.0.0.1', WK_DS_HTTP_PORT=str(rust_port),
            WK_DS_HTTP_URI=fixture_origin, WK_DS_KEY=env['WK_REPLAY_FIXTURE_KEY'], WK_DS_NAME='replay-ds',
            WK_DS_WEBKNOSSOS_URI=fixture_origin, WK_DS_REDIS_ADDRESS='127.0.0.1', WK_DS_REDIS_PORT=str(redis_port),
            WK_DS_BASE_DIRECTORIES=json.dumps([{'path': str(fixtures / 'datasets'), 'organizationId': None,
                                               'allowsUpload': False, 'doScan': False}]),
            WK_DS_WATCH_FILE_SYSTEM_ENABLED='false', WK_DS_DATA_VAULTS_CREDENTIALS='[]',
            WK_DS_LOCAL_DIRECTORY_WHITELIST='[]', WK_DS_SLACK_NOTIFICATIONS_URI='',
            WK_DS_SLACK_NOTIFICATIONS_VERBOSE_LOGGING_ENABLED='false', WK_DS_WRITE_VIRTUAL_DATASETS_MIRROR='false')
        rust = children.start('rust', [str(args.binary.resolve())], env=rust_env, cwd=output)
        services = [fixture, redis, scala, rust]
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
            (output / 'contract-corpus.json').write_text(json.dumps(contract, indent=2) + '\n')
        finally:
            for key, old in saved.items():
                if old is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = old
        report = differential.replay('http://127.0.0.1:' + str(scala_port),
                                     'http://127.0.0.1:' + str(rust_port), cases,
                                     args.rounds, args.request_timeout)
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        children.alive(services)
        summary['rss_kib_after'] = children.rss()
        summary['passed'] = report['passed']
        summary['mismatch_categories'] = dict(Counter(
            difference for result in report['results'] for difference in result['differences']))
        summary['mismatch_cases'] = sorted({result['case'] for result in report['results'] if result['differences']})
        contract_report = differential.replay('http://127.0.0.1:' + str(scala_port),
            'http://127.0.0.1:' + str(rust_port), contract_cases, args.rounds, args.request_timeout)
        (output / 'contract-report.json').write_text(json.dumps(contract_report, indent=2) + '\n')
        children.alive(services)
        summary['contract'] = {
            'cases': len(contract_cases), 'passed': contract_report['passed'],
            'mismatch_categories': dict(Counter(d for result in contract_report['results'] for d in result['differences'])),
            'mismatch_cases': sorted({result['case'] for result in contract_report['results'] if result['differences']})}
        summary['passed'] = summary['passed'] and contract_report['passed']
        summary['rss_kib_after'] = children.rss()
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
