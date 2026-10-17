#!/usr/bin/env python3
"""Prepare isolated Scala datastore config/classpath/command; never start services."""
import argparse
import json
import os
from pathlib import Path
import shlex

parser = argparse.ArgumentParser(description=__doc__)
source_group = parser.add_mutually_exclusive_group(required=True)
source_group.add_argument('--artifacts-root', type=Path,
                          help='checkout with sbt runtime classpath exports (webknossos-datastore/target/streams)')
source_group.add_argument('--stage-lib', type=Path,
                          help='lib directory of `sbt stage` (target/universal/stage/lib)')
parser.add_argument('--java', default='java', help='java executable (Play runs on JDK 21)')
parser.add_argument('--source-root', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--port', required=True, type=int)
parser.add_argument('--redis-port', required=True, type=int)
parser.add_argument('--wk-port', required=True, type=int)
parser.add_argument('--datastore-name', default='scala-replay-isolated')
parser.add_argument('--data-root', type=Path)
parser.add_argument('--key-env')
parser.add_argument('--upload-root', type=Path,
                    help='existing directory appended as an organization-agnostic upload base directory (upload phase); '
                         'listed after --data-root so non-upload lookups (JSON mappings) still resolve there')
args = parser.parse_args()
if not args.datastore_name or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in args.datastore_name):
    parser.error('datastore name must be a nonempty simple route segment')
key = os.environ.get(args.key_env) if args.key_env else 'isolated-replay-key'
if not key:
    parser.error('selected key environment variable is absent or empty')
ports = [args.port, args.redis_port, args.wk_port]
if len(set(ports)) != 3 or any(not 1024 <= p <= 65535 for p in ports):
    parser.error('three distinct unprivileged ports required')
output = args.output.resolve()
source = args.source_root.resolve()
standalone = source / "webknossos-datastore/conf/standalone-datastore.conf"
if not standalone.is_file():
    parser.error("authoritative standalone-datastore.conf missing from source root")
if not output.is_relative_to(Path('/private/tmp')) and not output.is_relative_to(Path('/tmp')):
    parser.error('output must be in a disposable /tmp directory')
if output.exists():
    parser.error('output already exists; use a new disposable directory')


def classpath_from_streams(root):
    streams = root / 'webknossos-datastore/target/streams/runtime'
    paths = []
    for name in ['internalDependencyClasspath', 'managedClasspath', 'unmanagedClasspath']:
        export = streams / name / '_global/streams/export'
        if not export.exists():
            parser.error(f'missing cached runtime export: {export}')
        paths.extend(p for p in export.read_text().strip().split(':') if p)
    # Sbt emits an optional empty web-assets directory. Do not include nonexistent entries.
    missing = [p for p in paths if not Path(p).exists()]
    if any(not p.endswith('/target/web/classes/main') for p in missing):
        parser.error(f'{len(missing)} runtime entries are missing; rebuild prerequisite artifacts')
    paths = list(dict.fromkeys(p for p in paths if Path(p).exists()))
    class_dirs = [Path(p) for p in paths if Path(p).is_dir()]
    for resource in ['router/Routes.class', 'DsRequestHandler.class', 'standalone-datastore.conf',
                     'com/scalableminds/webknossos/datastore/DataStoreModule.class']:
        if not any((p / resource).exists() for p in class_dirs):
            parser.error(f'missing compiled datastore resource: {resource}')
    if any((p / 'application.conf').exists() for p in class_dirs):
        parser.error('unexpected application.conf in runtime products; inspect before isolated launch')
    return paths


def classpath_from_stage(lib):
    # Staged jars without the main application and tracingstore; the datastore jar first so its
    # router.Routes wins (same selection as tools/app_differential/stack.py).
    own = 'webknossos-datastore.'
    excluded = ('webknossos.webknossos-wk', 'webknossos-tracingstore.')
    jars = sorted(p for p in lib.glob('*.jar') if not p.name.startswith(excluded))
    jars.sort(key=lambda p: 0 if p.name.startswith(own) else 1)
    if not jars or not jars[0].name.startswith(own):
        parser.error('stage lib has no webknossos-datastore jar; run `sbt stage` first')
    return [str(p) for p in jars]


paths = (classpath_from_stage(args.stage_lib.resolve()) if args.stage_lib
         else classpath_from_streams(args.artifacts_root.resolve()))
output.mkdir(parents=True)
data = args.data_root.resolve() if args.data_root else output / 'binaryData'
if not data.is_relative_to(Path('/private/tmp')) and not data.is_relative_to(Path('/tmp')):
    parser.error('data root must be in disposable /tmp storage')
if args.data_root and not data.is_dir():
    parser.error('provided data root must already be a directory')
if not args.data_root:
    data.mkdir()
base_directories = [f'{{path={json.dumps(str(data))},organizationId=null,allowsUpload=false,doScan=false}}']
if args.upload_root:
    if not args.upload_root.is_dir():
        parser.error('provided upload root must already be a directory')
    base_directories.append(f'{{path={json.dumps(str(args.upload_root.resolve()))},organizationId=null,'
                            'allowsUpload=true,doScan=false}')
conf = output / 'isolated.conf'
conf.write_text(f'''include file({json.dumps(str(standalone))})
http.address = "127.0.0.1"
http.port = {args.port}
http.uri = "http://127.0.0.1:{args.port}"
play.http.router = "router.Routes"
play.modules.disabled += "play.api.db.DBModule"
play.modules.disabled += "play.api.db.evolutions.EvolutionsModule"
pidfile.path = "/dev/null"
datastore.name = {json.dumps(args.datastore_name)}
datastore.key = {json.dumps(key)}
datastore.webKnossos.uri = "http://127.0.0.1:{args.wk_port}"
datastore.webKnossos.pingInterval = 10 minutes
datastore.watchFileSystem.enabled = false
datastore.baseDirectories = [{', '.join(base_directories)}]
datastore.localDirectoryWhitelist = []
datastore.dataVaults.credentials = []
datastore.redis.address = "127.0.0.1"
datastore.redis.port = {args.redis_port}
slackNotifications.uri = ""
''')
conf.chmod(0o600)
classpath = ':'.join(paths)
(output / 'classpath.txt').write_text(classpath + '\n')
command = [args.java, '-Xms256m', '-Xmx2g', f'-Dconfig.file={conf}',
           '-Dplay.http.router=router.Routes', '-cp', classpath,
           'play.core.server.ProdServerStart', str(output)]
(output / 'launch-command.json').write_text(json.dumps(command, indent=2) + '\n')
(output / 'launch-command.sh').write_text('#!/bin/sh\nexec ' + shlex.join(command) + '\n')
print(f'Prepared {len(paths)} classpath entries in {output}; no services started.')
print(f'Parent may explicitly execute: sh {shlex.quote(str(output / "launch-command.sh"))}')
