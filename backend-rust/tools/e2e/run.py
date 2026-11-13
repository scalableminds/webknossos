#!/usr/bin/env python3
"""Run the frontend backend-snapshot e2e tests (`yarn test-e2e`) against the Rust backend.

The counterpart of test/e2e/End2EndSpec.scala, which runs the same tests against Play. The tests
talk to one origin, http://localhost:9010 (E2E_BASE_URL in frontend/javascripts/test/e2e_setup.ts),
and every test file reloads test/db (whose dataStores/tracingStores rows point at that origin), so
a small reverse proxy on :9010 stands in for Play's embedded stores:

  :9010  proxy   /data/*     -> datastore     :9012  (Scala standalone, or --datastore rust)
                 /tracings/* -> tracingstore  :9013  (Scala standalone)
                 everything else -> Rust app  :9011
  :7156  FossilDB (temporary data dir)   :9015  Redis (no persistence)

None of these ports clash with a local dev setup (9000/9001/9050/9090/7155/6379). All state lives in
--work-dir (default target/e2e-rust/) and in the database wk_e2e_rust, which is created from
schema/schema.sql + test/db before the run and dropped afterwards (--keep keeps it and the logs).

  python3 backend-rust/tools/e2e/run.py                 # all *.e2e.ts files
  python3 backend-rust/tools/e2e/run.py -- datasets     # extra args go to vitest (file filter, -t ...)
  yarn test-e2e-rust [-- vitest args]

Snapshots are never updated: vitest runs with CI=true, so it neither rewrites mismatching nor
writes missing snapshots. Exit code is vitest's.
"""

from __future__ import annotations

import argparse
import http.client
import http.server
import json
import os
import re
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BACKEND_RUST = REPO / "backend-rust"
PORTS = {"proxy": 9010, "rust": 9011, "ds": 9012, "ts": 9013, "redis": 9015, "fossil": 7156}
PUBLIC_URI = f"http://localhost:{PORTS['proxy']}"  # E2E_BASE_URL and the test/db store URLs
RUST_URI = f"http://127.0.0.1:{PORTS['rust']}"
DATABASE = "wk_e2e_rust"
STORE_NAME = "localhost"  # test/db/dataStores.csv, tracingStores.csv
STORE_KEY = "something-secure"
# Play's silhouette.cookieAuthenticator.signerSecret from conf/application.conf (dev value, public).
PLAY_SIGNER_SECRET = "`?IVa2TCaZAZ4TY]B0=tCs9mJdyaA0V<mA4k[sq6gV=2C5y?liAhWF?ZMA0h1EIe"
FOSSIL_COLLECTIONS = (
    "skeletons,skeletonTreeBodies,volumes,volumeData,volumeSegmentIndex,editableMappingsInfo,"
    "editableMappingsAgglomerateToGraph,editableMappingsSegmentToAgglomerate,annotations,annotationUpdates"
)
DEFAULT_JAVA_HOME = "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
              "transfer-encoding", "upgrade"}


def log(message: str) -> None:
    print(f"[e2e-rust] {message}", flush=True)


# --- configuration ---------------------------------------------------------------------------------


def postgres_admin_url(args) -> str:
    return args.postgres_url.rstrip("/")


def database_url(args) -> str:
    base = postgres_admin_url(args)
    return base[: base.rfind("/")] + f"/{DATABASE}"


def play_features() -> dict:
    """The `features { ... }` block of conf/application.conf (flat keys, simple values only), plus
    End2EndSpec's override voxelyticsEnabled = true."""
    text = (REPO / "conf" / "application.conf").read_text()
    block = re.search(r"^features \{\n(.*?)^\}", text, re.S | re.M)
    if block is None:
        raise SystemExit("no features block in conf/application.conf")
    features = {}
    for line in block.group(1).splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        features[key] = json.loads(value)
    features["voxelyticsEnabled"] = True
    return features


def rust_env(args, data_dir: Path) -> dict:
    features = play_features()
    env = {
        "PATH": os.environ.get("PATH", ""),
        "DATABASE_URL": database_url(args),
        "WK_BIND": f"127.0.0.1:{PORTS['rust']}",
        "WK_PUBLIC_URL": PUBLIC_URI,
        "WK_DB_MAX_CONNECTIONS": "20",
        "WK_COOKIE_SIGNER_SECRET": PLAY_SIGNER_SECRET,
        "WK_FEATURES_JSON": json.dumps(features),
        "WK_JOBS_ENABLED": str(features["jobsEnabled"]).lower(),
        "WK_ALLOW_DELETE_DATASETS": str(features["allowDeleteDatasets"]).lower(),
        "WK_PASSKEYS_ENABLED": str(features["passkeysEnabled"]).lower(),
        "WK_IS_WKORG_INSTANCE": str(features["isWkorgInstance"]).lower(),
        "WK_REGISTER_TO_DEFAULT_ORGA_ENABLED": str(features["registerToDefaultOrgaEnabled"]).lower(),
        # Play dev config (webKnossos.user.emailVerification.*)
        "WK_EMAIL_VERIFICATION_ENABLED": "false",
        "WK_EMAIL_VERIFICATION_REQUIRED": "false",
        "WK_SAMPLE_ORGANIZATION_ENABLED": "false",  # End2EndSpec: -DwebKnossos.sampleOrganization.enabled=false
        "WK_UPLOAD_TO_PATHS_PREFIXES": str(data_dir),
        "WK_EXTERNAL_PATH_DELETION_KEY": STORE_KEY,
        "WK_DATASTORE_NAME": STORE_NAME,
        "WK_DATASTORE_KEY": STORE_KEY,
        "WK_TRACINGSTORE_NAME": STORE_NAME,
        "WK_TRACINGSTORE_KEY": STORE_KEY,
        "WK_SEGMENT_ANYTHING_URI": "http://localhost:8080",
        "WK_SEGMENT_ANYTHING_USER": "user",
        "WK_SEGMENT_ANYTHING_PASSWORD": "password",
        "WK_ANALYTICS_URI": "",
        "WK_SLACK_NOTIFICATIONS_URI": "",
        "WK_MAIL_SMTP_HOST": "",
        "RUST_LOG": os.environ.get("RUST_LOG", "webknossos_backend=info,tower_http=info"),
    }
    for key in ("TZ", "WK_DB_TIME_ZONE"):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


def scala_store_conf(kind: str, work: Path, data_dir: Path) -> Path:
    if kind == "ds":
        body = f"""include "{REPO}/webknossos-datastore/conf/standalone-datastore.conf"
http.port = {PORTS['ds']}
http.address = "127.0.0.1"
http.uri = "{PUBLIC_URI}"
datastore.key = "{STORE_KEY}"
datastore.name = "{STORE_NAME}"
datastore.publicUri = "{PUBLIC_URI}"
datastore.webKnossos.uri = "{RUST_URI}"
datastore.redis.port = {PORTS['redis']}
datastore.baseDirectories = [{{ path = "{data_dir}", organizationId = null, allowsUpload = true, doScan = true }}]
datastore.watchFileSystem.enabled = false
"""
    else:
        body = f"""include "{REPO}/webknossos-tracingstore/conf/standalone-tracingstore.conf"
http.port = {PORTS['ts']}
http.address = "127.0.0.1"
http.uri = "{PUBLIC_URI}"
tracingstore.key = "{STORE_KEY}"
tracingstore.name = "{STORE_NAME}"
tracingstore.publicUri = "{PUBLIC_URI}"
tracingstore.webKnossos.uri = "{RUST_URI}"
tracingstore.redis.port = {PORTS['redis']}
tracingstore.fossildb.port = {PORTS['fossil']}
"""
    path = work / f"{kind}.conf"
    path.write_text(body + 'slackNotifications.uri = ""\npidfile.path = "/dev/null"\n')
    return path


def rust_datastore_env(data_dir: Path) -> dict:
    return {
        "PATH": os.environ.get("PATH", ""),
        "RUST_LOG": os.environ.get("RUST_LOG", "info"),
        "WK_DS_HTTP_ADDRESS": "127.0.0.1",
        "WK_DS_HTTP_PORT": str(PORTS["ds"]),
        "WK_DS_HTTP_URI": PUBLIC_URI,
        "WK_DS_NAME": STORE_NAME,
        "WK_DS_KEY": STORE_KEY,
        "WK_DS_WEBKNOSSOS_URI": RUST_URI,
        "WK_DS_REDIS_ADDRESS": "127.0.0.1",
        "WK_DS_REDIS_PORT": str(PORTS["redis"]),
        "WK_DS_BASE_DIRECTORIES": json.dumps(
            [{"path": str(data_dir), "organizationId": None, "allowsUpload": True, "doScan": True}]),
        "WK_DS_WATCH_FILE_SYSTEM_ENABLED": "false",
        "WK_DS_SLACK_NOTIFICATIONS_URI": "",
    }


# --- processes -------------------------------------------------------------------------------------


class Stack:
    def __init__(self, work: Path):
        self.work = work
        self.logs = work / "logs"
        self.logs.mkdir(parents=True, exist_ok=True)
        self.processes: dict[str, subprocess.Popen] = {}

    def spawn(self, name: str, argv: list[str], env: dict | None = None, cwd: Path | None = None) -> None:
        logfile = open(self.logs / f"{name}.log", "wb")
        self.processes[name] = subprocess.Popen(argv, stdout=logfile, stderr=subprocess.STDOUT, env=env,
                                                cwd=cwd or REPO, start_new_session=True)

    def check_alive(self) -> None:
        for name, process in self.processes.items():
            if process.poll() is not None:
                raise SystemExit(f"{name} exited with {process.returncode}; see {self.logs / (name + '.log')}")

    def wait_http(self, name: str, url: str, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.check_alive()
            try:
                with urllib.request.urlopen(url, timeout=2) as response:
                    if response.status == 200:
                        return
            except Exception:
                pass
            time.sleep(0.5)
        raise SystemExit(f"{name} not healthy at {url} within {timeout:.0f}s; see {self.logs / (name + '.log')}")

    def wait_port(self, name: str, port: int, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.check_alive()
            if listening(port):
                return
            time.sleep(0.5)
        raise SystemExit(f"{name} not listening on :{port} within {timeout:.0f}s")

    def stop(self) -> None:
        for name, process in reversed(list(self.processes.items())):
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    continue
        for name, process in self.processes.items():
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                log(f"{name} did not stop, killing it")
                os.killpg(process.pid, signal.SIGKILL)


def listening(port: int) -> bool:
    return subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True).returncode == 0


# --- proxy -----------------------------------------------------------------------------------------


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    upstreams: dict[str, int] = {}
    access_log = None

    def upstream_port(self) -> int:
        path = self.path
        if path.startswith("/data/") or path == "/data":
            return self.upstreams["ds"]
        if path.startswith("/tracings/") or path == "/tracings":
            return self.upstreams["ts"]
        return self.upstreams["rust"]

    def read_body(self) -> bytes | None:
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            chunks = []
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip(), 16)
                if size == 0:
                    while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                        pass
                    return b"".join(chunks)
                chunks.append(self.rfile.read(size))
                self.rfile.readline()
        length = self.headers.get("Content-Length")
        return self.rfile.read(int(length)) if length else None

    def forward(self) -> None:
        body = self.read_body()
        port = self.upstream_port()
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP and k.lower() != "content-length"}
        if body is not None:
            headers["Content-Length"] = str(len(body))
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=600)
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
        except OSError as error:
            payload = f"e2e proxy: upstream :{port} failed: {error}".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        finally:
            connection.close()
        self.send_response_only(response.status, response.reason)
        for key, value in response.getheaders():
            if key.lower() not in HOP_BY_HOP and key.lower() != "content-length":
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)
        if self.access_log is not None:
            self.access_log.write(f"{self.command} {self.path} -> :{port} {response.status}\n")
            self.access_log.flush()

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = forward

    def log_message(self, *_args) -> None:  # access log above instead of stderr
        pass


class ThreadingProxy(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class DualStackProxy(ThreadingProxy):
    """Listens on ::1 and 127.0.0.1 alike; `localhost` may resolve to either."""
    address_family = socket.AF_INET6

    def server_bind(self) -> None:
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def start_proxy(stack: Stack) -> None:
    ProxyHandler.upstreams = {"rust": PORTS["rust"], "ds": PORTS["ds"], "ts": PORTS["ts"]}
    ProxyHandler.access_log = open(stack.logs / "proxy.log", "w")
    server = DualStackProxy(("::", PORTS["proxy"]), ProxyHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()


# --- steps -----------------------------------------------------------------------------------------


def check_ports() -> None:
    busy = [f"{name} :{port}" for name, port in PORTS.items() if listening(port)]
    if busy:
        raise SystemExit("ports already in use: " + ", ".join(busy) + " (another e2e run? End2EndSpec?)")


def psql(url: str, sql: str) -> str:
    result = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-Atqc", sql], capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"psql failed: {result.stderr.strip()}")
    return result.stdout.strip()


def node_env(args) -> dict:
    env = dict(os.environ)
    env["PATH"] = f"/opt/homebrew/bin:{env.get('PATH', '')}" if Path("/opt/homebrew/bin/node").exists() else env["PATH"]
    env["POSTGRES_URL"] = database_url(args)  # tools/postgres/dbtool.js, also used by resetDatabase()
    return env


def create_database(args) -> None:
    admin = postgres_admin_url(args)
    psql(admin, f"DROP DATABASE IF EXISTS {DATABASE} WITH (FORCE)")
    psql(admin, f"CREATE DATABASE {DATABASE}")
    log(f"created database {DATABASE}; loading schema/schema.sql and test/db")
    result = subprocess.run(["node", "tools/postgres/dbtool.js", "prepare-test-db"], cwd=REPO, env=node_env(args),
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"dbtool prepare-test-db failed:\n{result.stdout}\n{result.stderr}")


def drop_database(args) -> None:
    psql(postgres_admin_url(args), f"DROP DATABASE IF EXISTS {DATABASE} WITH (FORCE)")


def prepare_data_dir(work: Path) -> Path:
    """Like End2EndSpec.ensureTestDataset, but in the work dir instead of the repo's binaryData."""
    data_dir = work / "binaryData"
    if data_dir.exists():
        if shutil.which("trash"):  # macOS: never rm (see AGENTS.md)
            subprocess.run(["trash", str(data_dir)], check=True)
        else:
            shutil.rmtree(data_dir)
    organization_dir = data_dir / "Organization_X"
    organization_dir.mkdir(parents=True)
    with zipfile.ZipFile(REPO / "test" / "dataset" / "test-dataset.zip") as archive:
        archive.extractall(organization_dir)  # the zip's single top-level directory is test-dataset/
    if not (organization_dir / "test-dataset" / "datasource-properties.json").stat().st_size:
        raise SystemExit("test dataset was not unzipped correctly")
    return data_dir


def build(args) -> None:
    for package in ["webknossos-backend"] + (["webknossos-datastore"] if args.datastore == "rust" else []):
        log(f"cargo build --release -p {package}")
        subprocess.run(["cargo", "build", "--release", "--locked", "-p", package], cwd=BACKEND_RUST, check=True)
    stage_bins = [REPO / "webknossos-tracingstore/target/universal/stage/bin/webknossos-tracingstore"]
    if args.datastore == "scala":
        stage_bins.append(REPO / "webknossos-datastore/target/universal/stage/bin/webknossos-datastore")
    if args.stage or not all(b.exists() for b in stage_bins):
        log("sbt stage of the Scala standalone stores")
        tasks = ["webknossosTracingstore/stage"] + (["webknossosDatastore/stage"] if args.datastore == "scala" else [])
        env = {**os.environ, **({"JAVA_HOME": args.java_home} if Path(args.java_home).exists() else {})}
        subprocess.run(["sbt", "-batch", "--no-server", *tasks], cwd=REPO, check=True, env=env)


def fossil_jar(work: Path) -> Path:
    if os.environ.get("WK_E2E_FOSSIL_JAR"):
        return Path(os.environ["WK_E2E_FOSSIL_JAR"])
    version = (REPO / "fossildb" / "version").read_text().strip()
    repo_jar = REPO / "fossildb" / "fossildb.jar"
    if repo_jar.exists():
        return repo_jar
    cached = work.parent / f"fossildb-{version}.jar"
    if not cached.exists():
        url = f"https://github.com/scalableminds/fossildb/releases/download/{version}/fossildb.jar"
        log(f"downloading FossilDB {version}")
        urllib.request.urlretrieve(url, cached)
    return cached


def start_stack(args, stack: Stack, data_dir: Path) -> None:
    work = stack.work
    redis_dir = work / "redis"
    redis_dir.mkdir(exist_ok=True)
    stack.spawn("redis", ["redis-server", "--bind", "127.0.0.1", "--port", str(PORTS["redis"]),
                          "--dir", str(redis_dir), "--save", "", "--appendonly", "no"])
    fossil_dir = work / "fossildb"
    fossil_dir.mkdir(exist_ok=True)
    java = str(Path(args.java_home) / "bin" / "java") if Path(args.java_home).exists() else "java"
    stack.spawn("fossildb", [java, "-jar", str(fossil_jar(work)), "-p", str(PORTS["fossil"]),
                             "-c", FOSSIL_COLLECTIONS, "-d", str(fossil_dir / "data"), "-b", str(fossil_dir / "backup")])
    stack.wait_port("redis", PORTS["redis"], 30)
    stack.wait_port("fossildb", PORTS["fossil"], 60)

    rust_binary = BACKEND_RUST / "target" / "release" / "webknossos-backend"
    stack.spawn("rust", [str(rust_binary)], env=rust_env(args, data_dir), cwd=BACKEND_RUST)
    stack.wait_http("rust", f"{RUST_URI}/health/ready", 60)

    java_opts = ["-java-home", args.java_home] if Path(args.java_home).exists() else []
    ts_bin = REPO / "webknossos-tracingstore/target/universal/stage/bin/webknossos-tracingstore"
    stack.spawn("tracingstore", [str(ts_bin), *java_opts, "-J-Xmx2G", f"-Dconfig.file={scala_store_conf('ts', work, data_dir)}",
                                 "-Dpidfile.path=/dev/null"])
    if args.datastore == "scala":
        ds_bin = REPO / "webknossos-datastore/target/universal/stage/bin/webknossos-datastore"
        stack.spawn("datastore", [str(ds_bin), *java_opts, "-J-Xmx2G",
                                  f"-Dconfig.file={scala_store_conf('ds', work, data_dir)}", "-Dpidfile.path=/dev/null"])
    else:
        stack.spawn("datastore", [str(BACKEND_RUST / "target" / "release" / "webknossos-datastore")],
                    env=rust_datastore_env(data_dir), cwd=REPO)
    stack.wait_http("datastore", f"http://127.0.0.1:{PORTS['ds']}/data/health", 180)
    stack.wait_http("tracingstore", f"http://127.0.0.1:{PORTS['ts']}/tracings/health", 180)
    start_proxy(stack)
    stack.wait_http("proxy", f"{PUBLIC_URI}/api/health", 10)


def run_tests(args) -> int:
    (REPO / "frontend/javascripts/test/snapshots/type_check").mkdir(parents=True, exist_ok=True)
    env = node_env(args)
    env["CI"] = "true"  # never write snapshots (neither mismatching nor missing ones)
    command = ["yarn", "test-e2e", *args.vitest_args]
    log("running " + " ".join(command))
    return subprocess.run(command, cwd=REPO, env=env).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--datastore", choices=("scala", "rust"), default="scala",
                        help="datastore behind /data (default: the Scala standalone store, like Play's embedded one)")
    parser.add_argument("--postgres-url", default=os.environ.get("WK_E2E_POSTGRES_URL",
                                                                 "postgres://postgres:postgres@127.0.0.1:5432/postgres"),
                        help="admin connection (CREATEDB); the run uses database wk_e2e_rust on the same server")
    parser.add_argument("--work-dir", type=Path, default=Path(os.environ.get("WK_E2E_DIR", REPO / "target" / "e2e-rust")))
    parser.add_argument("--java-home", default=os.environ.get("WK_E2E_JAVA_HOME", os.environ.get("JAVA_HOME", DEFAULT_JAVA_HOME)))
    parser.add_argument("--no-build", action="store_true", help="skip cargo build / sbt stage")
    parser.add_argument("--stage", action="store_true", help="re-run sbt stage of the Scala stores")
    parser.add_argument("--keep", action="store_true", help="keep the database wk_e2e_rust after the run")
    parser.add_argument("--serve", action="store_true", help="start the stack and wait (Ctrl-C) instead of running tests")
    parser.add_argument("vitest_args", nargs="*", help="passed to vitest (after --)")
    args = parser.parse_args()

    check_ports()
    if not args.no_build:
        build(args)
    work = args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    data_dir = prepare_data_dir(work)
    stack = Stack(work)
    # Tear down on Ctrl-C and SIGTERM alike (a backgrounded shell job inherits SIGINT as ignored).
    signal.signal(signal.SIGINT, signal.default_int_handler)
    signal.signal(signal.SIGTERM, signal.default_int_handler)
    exit_code = 1
    try:
        create_database(args)
        start_stack(args, stack, data_dir)
        log(f"stack up: {PUBLIC_URI} (logs in {stack.logs})")
        if args.serve:
            log("serving; Ctrl-C to stop")
            while True:
                time.sleep(1)
                stack.check_alive()
        exit_code = run_tests(args)
    except KeyboardInterrupt:
        exit_code = 130
    finally:
        log("stopping")
        stack.stop()
        if args.keep:
            log(f"kept database {DATABASE}")
        else:
            drop_database(args)
    log(f"done, exit code {exit_code}; logs in {stack.logs}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
