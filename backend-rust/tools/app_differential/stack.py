#!/usr/bin/env python3
"""Isolated Play-vs-Rust main application stack for differential replay.

Topology (all loopback, all state under WK_DIFF_DIR, default /tmp/wk-diff):

  Play side:  Play (main app + embedded datastore/tracingstore)  :19590  DB wk_diff_play
  Rust side:  Rust main app                                       :19591  DB wk_diff_rust
              Scala standalone datastore (calls back Rust)        :19595
              Scala standalone tracingstore (calls back Rust)     :19596
  Shared:     Redis :19592 (no persistence), FossilDB :19593 (temporary data dir)

Both databases are clones of `wk_diff_seed`, which is created from schema/schema.sql and filled
by Play's own initial-data insertion. Only databases named `wk_diff_*` are ever created or dropped.

  python3 tools/app_differential/stack.py seed     # (re)create wk_diff_seed via Play
  python3 tools/app_differential/stack.py reset    # fresh wk_diff_play / wk_diff_rust clones
  python3 tools/app_differential/stack.py start    # start every process, wait for health
  python3 tools/app_differential/stack.py restart-rust  # after cargo build --release
  python3 tools/app_differential/stack.py stop     # SIGTERM the processes this tool started
  python3 tools/app_differential/stack.py status
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[3]
BACKEND_RUST = WORKTREE / "backend-rust"
STAGE = WORKTREE / "target" / "universal" / "stage"
WORK = Path(os.environ.get("WK_DIFF_DIR", "/tmp/wk-diff"))
JAVA_HOME = os.environ.get(
    "WK_DIFF_JAVA_HOME", "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
)
FOSSIL_JAR = Path(
    os.environ.get(
        "WK_DIFF_FOSSIL_JAR", str(WORKTREE.parents[2] / "fossildb" / "fossildb.jar")
    )
)
RUST_BINARY = Path(
    os.environ.get("WK_DIFF_RUST_BINARY", str(BACKEND_RUST / "target" / "release" / "webknossos-backend"))
)

# redis_rust: the Rust side's stores get their own Redis; datastore upload state is keyed by the
# client's upload id, so a shared Redis would let one side's reservation leak into the other.
PORTS = {"oidc": 19589, "play": 19590, "rust": 19591, "redis": 19592, "fossil": 19593, "redis_rust": 19594, "ds": 19595,
         "ts": 19596, "metrics": 19598}
PG = {"host": "127.0.0.1", "port": "5432", "user": "postgres", "password": "postgres"}
PLAY_URI = f"http://127.0.0.1:{PORTS['play']}"
RUST_URI = f"http://127.0.0.1:{PORTS['rust']}"
OIDC_URI = f"http://127.0.0.1:{PORTS['oidc']}"
# Public URI of both applications (Play's http.uri, Rust's WK_PUBLIC_URL). corpus/webauthn.json needs
# WK_DIFF_PUBLIC_URI=https://localhost:19590 (passkeys refuse http; the URI is only compared as a
# string, no TLS involved). Not the default: Play's embedded datastore reports http.uri as its own
# URL, after which Play's datastore calls fail, so the other corpora run with the http URI.
PUBLIC_URI = os.environ.get("WK_DIFF_PUBLIC_URI", PLAY_URI)
STORE_KEY = "something-secure"  # Play dev default; matches the seeded dataStores/tracingStores rows
SAMPLE_TOKEN = "secretSampleUserToken"
FOSSIL_COLLECTIONS = (
    "skeletons,skeletonTreeBodies,volumes,volumeData,volumeSegmentIndex,editableMappingsInfo,"
    "editableMappingsAgglomerateToGraph,editableMappingsSegmentToAgglomerate,annotations,annotationUpdates"
)
# Play's silhouette.cookieAuthenticator.signerSecret from conf/application.conf (dev value, public).
PLAY_SIGNER_SECRET = "`?IVa2TCaZAZ4TY]B0=tCs9mJdyaA0V<mA4k[sq6gV=2C5y?liAhWF?ZMA0h1EIe"

WORKER_ID = "6194dc03040200b0027f28a1"
WORKER_KEY = "secretWorkerKey"
WORKER_COMMANDS = ("compute_mesh_file", "convert_to_wkw", "export_tiff", "find_largest_segment_id",
                   "globalize_floodfills", "infer_nuclei", "infer_neurons", "materialize_volume_annotation",
                   "render_animation", "compute_segment_index_file", "infer_mitochondria", "train_neuron_model",
                   "train_instance_model", "infer_instances", "align_sections")

STATE = WORK / "state.json"
LOGS = WORK / "logs"


def psql(database: str, sql: str) -> str:
    env = {**os.environ, "PGPASSWORD": PG["password"]}
    result = subprocess.run(
        ["psql", "-h", PG["host"], "-p", PG["port"], "-U", PG["user"], "-d", database,
         "-v", "ON_ERROR_STOP=1", "-Atq", "-c", sql],
        env=env, capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"psql failed on {database}: {result.stderr.strip()}")
    return result.stdout.strip()


def require_diff_name(name: str) -> str:
    if not name.startswith("wk_diff_") or not name.replace("_", "").isalnum():
        raise SystemExit(f"refusing to touch database {name!r}: only wk_diff_* is allowed")
    return name


def drop_database(name: str) -> None:
    psql("postgres", f"DROP DATABASE IF EXISTS {require_diff_name(name)} WITH (FORCE)")


def play_conf(database: str, path: Path) -> Path:
    path.write_text(f"""include "{WORKTREE}/conf/application.conf"
http.port = {PORTS['play']}
http.uri = "{PUBLIC_URI}"
datastore.publicUri = "{PLAY_URI}"
datastore.webKnossos.uri = "{PLAY_URI}"
tracingstore.publicUri = "{PLAY_URI}"
tracingstore.webKnossos.uri = "{PLAY_URI}"
slick.db.url = "jdbc:postgresql://{PG['host']}:{PG['port']}/{database}"
slick.db.user = "{PG['user']}"
slick.db.password = "{PG['password']}"
slick.db.minConnections = 2
slick.db.maxConnections = 20
slick.db.numThreads = 20
slick.checkSchemaOnStartup = false
tracingstore.redis.port = {PORTS['redis']}
tracingstore.fossildb.port = {PORTS['fossil']}
datastore.redis.port = {PORTS['redis']}
datastore.baseDirectories = [{{ path = "{WORK}/play-data/binaryData", organizationId = null, allowsUpload = true, doScan = false }}]
datastore.watchFileSystem.enabled = false
backendAnalytics.uri = ""
slackNotifications.uri = ""
features.jobsEnabled = true
features.voxelyticsEnabled = true
features.openIdConnectEnabled = true
features.passkeysEnabled = true
singleSignOn.openIdConnect.providerUrl = "{OIDC_URI}/"
singleSignOn.openIdConnect.clientId = "diff-client"
singleSignOn.openIdConnect.clientSecret = "diff-secret"
singleSignOn.openIdConnect.scope = "openid profile email"
pidfile.path = "/dev/null"
""")
    return path


def standalone_conf(kind: str, path: Path) -> Path:
    if kind == "ds":
        body = f"""include "{WORKTREE}/webknossos-datastore/conf/standalone-datastore.conf"
http.port = {PORTS['ds']}
http.uri = "http://127.0.0.1:{PORTS['ds']}"
datastore.key = "{STORE_KEY}"
datastore.name = "localhost"
datastore.webKnossos.uri = "{RUST_URI}"
datastore.redis.port = {PORTS['redis_rust']}
datastore.baseDirectories = [{{ path = "{WORK}/rust-data/binaryData", organizationId = null, allowsUpload = true, doScan = false }}]
datastore.watchFileSystem.enabled = false
slackNotifications.uri = ""
"""
    else:
        body = f"""include "{WORKTREE}/webknossos-tracingstore/conf/standalone-tracingstore.conf"
http.port = {PORTS['ts']}
http.uri = "http://127.0.0.1:{PORTS['ts']}"
tracingstore.key = "{STORE_KEY}"
tracingstore.name = "localhost"
tracingstore.webKnossos.uri = "{RUST_URI}"
tracingstore.redis.port = {PORTS['redis_rust']}
tracingstore.fossildb.port = {PORTS['fossil']}
slackNotifications.uri = ""
"""
    path.write_text(body + 'pidfile.path = "/dev/null"\n')
    return path


def standalone_classpath(kind: str) -> str:
    """Staged jars without the main application; the service's own jar first so its router wins."""
    lib = STAGE / "lib"
    own = {"ds": "webknossos-datastore.", "ts": "webknossos-tracingstore."}[kind]
    excluded = ("webknossos.webknossos-wk",) + (("webknossos-tracingstore.",) if kind == "ds" else ())
    jars = sorted(p for p in lib.glob("*.jar") if not p.name.startswith(excluded))
    jars.sort(key=lambda p: 0 if p.name.startswith(own) else 1)
    return ":".join(str(p) for p in jars)


def rust_env(database: str, features: dict, build: dict) -> dict:
    """Mirror Play's dev configuration (conf/application.conf) so behavior is comparable."""
    return {
        "PATH": os.environ.get("PATH", ""),
        "DATABASE_URL": f"postgres://{PG['user']}:{PG['password']}@{PG['host']}:{PG['port']}/{database}",
        "WK_BIND": f"127.0.0.1:{PORTS['rust']}",
        "WK_PUBLIC_URL": PUBLIC_URI,  # same public URI as Play so generated links compare equal
        "WK_DB_MAX_CONNECTIONS": "20",
        "WK_COOKIE_SIGNER_SECRET": PLAY_SIGNER_SECRET,
        "WK_FEATURES_JSON": json.dumps(features),
        "WK_JOBS_ENABLED": str(features.get("jobsEnabled", False)).lower(),
        "WK_ALLOW_DELETE_DATASETS": str(features.get("allowDeleteDatasets", True)).lower(),
        "WK_PASSKEYS_ENABLED": str(features.get("passkeysEnabled", False)).lower(),
        "WK_IS_WKORG_INSTANCE": str(features.get("isWkorgInstance", False)).lower(),
        "WK_REGISTER_TO_DEFAULT_ORGA_ENABLED": str(features.get("registerToDefaultOrgaEnabled", True)).lower(),
        "WK_EMAIL_VERIFICATION_ENABLED": "false",  # Play: webKnossos.user.emailVerification.activated
        "WK_EMAIL_VERIFICATION_REQUIRED": "false",
        "WK_SAMPLE_ORGANIZATION_ENABLED": "true",
        "WK_SAMPLE_USER_EMAIL": "sample@scm.io",
        "WK_SAMPLE_USER_PASSWORD": "secret",
        "WK_SAMPLE_USER_TOKEN": SAMPLE_TOKEN,
        "WK_SAMPLE_USER_IS_SUPER_USER": "true",
        # Play falls back to its embedded datastore's base directory; Rust has no datastore config.
        # oidc_mock.py (both backends use the same provider and client)
        "WK_OIDC_ENABLED": str(features.get("openIdConnectEnabled", False)).lower(),
        "WK_OIDC_PROVIDER_URL": f"{OIDC_URI}/",
        "WK_OIDC_CLIENT_ID": "diff-client",
        "WK_OIDC_CLIENT_SECRET": "diff-secret",
        "WK_OIDC_SCOPE": "openid profile email",
        "WK_UPLOAD_TO_PATHS_PREFIXES": f"{WORK}/rust-data/binaryData",
        "WK_DATASTORE_NAME": "localhost",
        "WK_DATASTORE_KEY": STORE_KEY,
        "WK_TRACINGSTORE_NAME": "localhost",
        "WK_TRACINGSTORE_KEY": STORE_KEY,
        "WK_SEGMENT_ANYTHING_URI": "http://localhost:8080",
        "WK_SEGMENT_ANYTHING_USER": "user",
        "WK_SEGMENT_ANYTHING_PASSWORD": "password",
        "WK_ANALYTICS_URI": "",
        "WK_SLACK_NOTIFICATIONS_URI": "",
        "WK_METRICS_BIND": f"127.0.0.1:{PORTS['metrics']}",
        "WK_MAIL_SMTP_HOST": "",
        "RUST_LOG": "webknossos_backend=info,tower_http=info",
        # Play bakes these into BuildInfo at `sbt stage` time (NML writerGitCommit, /api/buildinfo); give Rust
        # the values of the running Play, not the worktree's current HEAD, which moves with every commit.
        "WK_BUILD_COMMIT_HASH": build["commitHash"],
        "WK_BUILD_COMMIT_DATE": build["commitDate"],
    }


def spawn(name: str, argv: list[str], env: dict | None = None, cwd: Path | None = None) -> int:
    LOGS.mkdir(parents=True, exist_ok=True)
    log = open(LOGS / f"{name}.log", "ab")
    process = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, env=env,
                               cwd=cwd or WORKTREE, start_new_session=True)
    return process.pid


def listening(port: int) -> bool:
    return subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"],
                          capture_output=True).returncode == 0


def wait_http(url: str, timeout: float, name: str) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit(f"{name} did not become healthy at {url} within {timeout}s (see {LOGS}/{name}.log)")


def load_state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2))


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def terminate(names: list[str] | None = None) -> None:
    state = load_state()
    for name, pid in list(state.items()):
        if names is not None and name not in names:
            continue
        if alive(pid):
            os.killpg(pid, signal.SIGTERM)
            for _ in range(60):
                if not alive(pid):
                    break
                time.sleep(0.5)
        state.pop(name)
    save_state(state)


def start_play(database: str, name: str = "play") -> int:
    conf = play_conf(database, WORK / f"{name}.conf")
    return spawn(name, [str(STAGE / "bin" / "webknossos"), "-java-home", JAVA_HOME, "-J-Xmx3G",
                        f"-Dconfig.file={conf}", f"-Dhttp.port={PORTS['play']}", "-Dpidfile.path=/dev/null"])


def ensure_shared(state: dict) -> None:
    for name in ("redis", "redis_rust"):
        if not listening(PORTS[name]):
            (WORK / name).mkdir(parents=True, exist_ok=True)
            state[name] = spawn(name, ["redis-server", "--bind", "127.0.0.1", "--port", str(PORTS[name]),
                                       "--dir", str(WORK / name), "--save", "", "--appendonly", "no"])
    if not listening(PORTS["fossil"]):
        (WORK / "fossil").mkdir(parents=True, exist_ok=True)  # RocksDB creates only the leaf directory
        state["fossil"] = spawn("fossil", ["java", "-jar", str(FOSSIL_JAR), "-p", str(PORTS["fossil"]),
                                           "-c", FOSSIL_COLLECTIONS, "-d", str(WORK / "fossil" / "data"),
                                           "-b", str(WORK / "fossil" / "backup")])
    if not listening(PORTS["oidc"]):
        state["oidc"] = spawn("oidc", [sys.executable, str(Path(__file__).parent / "oidc_mock.py"),
                                       "--port", str(PORTS["oidc"]),
                                       "--redirect-uri", f"{PUBLIC_URI}/api/auth/oidc/callback"])
        wait_http(f"{OIDC_URI}/health", 30, "oidc")
    save_state(state)


def cmd_seed(_args) -> None:
    if listening(PORTS["play"]):
        raise SystemExit("port 19590 busy; run `stop` first")
    drop_database("wk_diff_seed")
    psql("postgres", "CREATE DATABASE wk_diff_seed")
    env = {**os.environ, "PGPASSWORD": PG["password"]}
    subprocess.run(["psql", "-h", PG["host"], "-p", PG["port"], "-U", PG["user"], "-d", "wk_diff_seed",
                    "-q", "-v", "ON_ERROR_STOP=1", "-f", str(WORKTREE / "schema" / "schema.sql")],
                   env=env, check=True, capture_output=True)
    state = load_state()
    ensure_shared(state)
    log = LOGS / "play-seed.log"
    log.unlink(missing_ok=True)
    state["play-seed"] = start_play("wk_diff_seed", "play-seed")
    save_state(state)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        text = log.read_text(errors="replace") if log.exists() else ""
        if "startup complete" in text:
            break
        time.sleep(1)
    else:
        raise SystemExit(f"Play seed start did not complete; see {log}")
    # initial data insertion runs asynchronously right before the startup-complete log line
    time.sleep(3)
    terminate(["play-seed"])
    print(psql("wk_diff_seed", "SELECT count(*) FROM webknossos.organizations") + " organization(s) seeded")


def cmd_reset(args) -> None:
    state = load_state()
    if any(name in state and alive(state[name]) for name in ("play", "rust", "ds", "ts")):
        raise SystemExit("stop the services first")
    for name in ("wk_diff_play", "wk_diff_rust"):
        drop_database(name)
        psql("postgres", f"CREATE DATABASE {name} TEMPLATE wk_diff_seed")
    psql("wk_diff_rust",
         f"UPDATE webknossos.dataStores SET url = 'http://127.0.0.1:{PORTS['ds']}', "
         f"publicUrl = 'http://127.0.0.1:{PORTS['ds']}' WHERE name = 'localhost'; "
         f"UPDATE webknossos.tracingStores SET url = 'http://127.0.0.1:{PORTS['ts']}', "
         f"publicUrl = 'http://127.0.0.1:{PORTS['ts']}' WHERE name = 'localhost'")
    # The dev worker of tools/postgres/dbtool.js enable-jobs (corpus/jobs_ai.json drives its protocol).
    for name in ("wk_diff_play", "wk_diff_rust"):
        psql(name, f"INSERT INTO webknossos.workers(_id, _dataStore, key, supportedJobCommands, name) "
                   f"VALUES ('{WORKER_ID}', 'localhost', '{WORKER_KEY}', '{{{','.join(WORKER_COMMANDS)}}}', "
                   f"'Dev Worker') ON CONFLICT (_id) DO NOTHING")
    for side in ("play-data", "rust-data"):
        (WORK / side / "binaryData").mkdir(parents=True, exist_ok=True)
    if args.volume:
        env = {**os.environ, "PGPASSWORD": PG["password"]}
        for name in ("wk_diff_play", "wk_diff_rust"):
            subprocess.run(["psql", "-h", PG["host"], "-p", PG["port"], "-U", PG["user"], "-d", name, "-q",
                            "-v", "ON_ERROR_STOP=1", "-f", str(Path(__file__).parent / "volume.sql")],
                           env=env, check=True, capture_output=True)
        print("applied volume.sql (2000 datasets, 300 users, 5000 annotations) to both clones")
    # Rows changed after this instant were written by the services under test (replay's time window).
    (WORK / "reset_at_ms").write_text(str(int(time.time() * 1000)))
    print("wk_diff_play and wk_diff_rust recreated from wk_diff_seed")


def cmd_start(_args) -> None:
    state = load_state()
    ensure_shared(state)
    for name in ("play", "rust", "ds", "ts"):
        if listening(PORTS[name]):
            raise SystemExit(f"port {PORTS[name]} ({name}) already in use")
    state["play"] = start_play("wk_diff_play")
    save_state(state)
    wait_http(f"{PLAY_URI}/api/health", 180, "play")
    start_rust(state)
    java = str(Path(JAVA_HOME) / "bin" / "java")
    for kind in ("ds", "ts"):
        conf = standalone_conf(kind, WORK / f"{kind}.conf")
        state[kind] = spawn(kind, [java, "-Xmx2G", f"-Dconfig.file={conf}", "-cp", standalone_classpath(kind),
                                   "play.core.server.ProdServerStart", str(WORK / f"{kind}-root")])
        (WORK / f"{kind}-root").mkdir(exist_ok=True)
        save_state(state)
    wait_http(f"http://127.0.0.1:{PORTS['ds']}/data/health", 180, "ds")
    wait_http(f"http://127.0.0.1:{PORTS['ts']}/tracings/health", 180, "ts")
    (WORK / "public_uri").write_text(PUBLIC_URI)  # replay.py skips corpora needing another one
    print(json.dumps({"started": state, "play": PLAY_URI, "rust": RUST_URI, "public_uri": PUBLIC_URI}))


def play_runtime() -> tuple[dict, dict]:
    """Features JSON and build info of the running Play, which Rust mirrors."""
    with urllib.request.urlopen(f"{PLAY_URI}/api/features", timeout=10) as response:
        features = json.load(response)
    with urllib.request.urlopen(f"{PLAY_URI}/api/buildinfo", timeout=10) as response:
        build = json.load(response)["webknossos"]
    return features, build


def start_rust(state: dict) -> None:
    features, build = play_runtime()
    if not RUST_BINARY.exists():
        raise SystemExit(f"missing Rust binary {RUST_BINARY}; cargo build --release --locked")
    state["rust"] = spawn("rust", [str(RUST_BINARY)], env=rust_env("wk_diff_rust", features, build), cwd=BACKEND_RUST)
    save_state(state)
    wait_http(f"{RUST_URI}/health/ready", 60, "rust")


def cmd_restart_rust(_args) -> None:
    """Restart only the Rust backend (after `cargo build --release`); databases are kept."""
    terminate(["rust"])
    state = load_state()
    start_rust(state)
    print(json.dumps({"rust": state["rust"]}))


def cmd_stop(_args) -> None:
    terminate()
    print("stopped")


def cmd_status(_args) -> None:
    state = load_state()
    print(json.dumps({name: {"pid": pid, "alive": alive(pid)} for name, pid in state.items()}, indent=2))
    for name, port in PORTS.items():
        print(f"{name:7} :{port} {'listening' if listening(port) else '-'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("seed", "reset", "start", "stop", "status", "restart-rust"):
        command = sub.add_parser(name)
        if name == "reset":
            command.add_argument("--volume", action="store_true", help="also apply volume.sql to both clones")
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    {"seed": cmd_seed, "reset": cmd_reset, "start": cmd_start, "stop": cmd_stop, "status": cmd_status,
     "restart-rust": cmd_restart_rust}[
        args.command](args)


if __name__ == "__main__":
    sys.exit(main())
