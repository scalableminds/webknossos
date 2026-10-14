# Actual Scala datastore: isolated cached-artifact launcher

This launches Play's real Guice datastore/router and JNI code, not a Rust substitute or a manually reimplemented Scala contract. Preparation was verified; actual launch is parent-owned. No existing JVM9001/7155 or other live service was stopped or reconfigured.

## Verified local prerequisites

The rust worktree has no Scala `target` artifacts. Canonical checkout `/Users/therold/Programming/scalableminds/webknossos` does: runtime managed-classpath export contains 234 existing jars, including Play3.0.11 server/Pekko HTTP/Guice/AHC WS, Scala3.8.4, Lettuce, AWS/GCS, and JHDF5. Runtime internal export includes datastore classes, util classes and JNI classes. One optional `target/web/classes/main` directory is absent and safely omitted. The assembled classpath has 237 existing entries; main application and tracingstore class directories are excluded.

Compiled `router/Routes.class`, `DsRequestHandler.class`, `DataStoreModule.class` and standalone config are present. Comparing 283 tracked files under datastore app/conf, util/src, JNI/src, project and build.sbt between canonical checkout and the rust worktree found zero byte differences (2026-10-12). This establishes source equivalence, not a guarantee of cached-bytecode freshness; record artifact checksums/compile provenance for final acceptance or coordinate a clean rebuild if runtime contracts disagree.

Java is Homebrew OpenJDK21.0.10 arm64. JNI resource exists at `webknossos-jni/target/classes/native/arm64-darwin/libwebknossosJni0.dylib`; `NativeLoaderUtils` chooses `/native/<uname-machine>-<uname-system-lowercase>/<mapped-library-name>`. `otool -L` shows the present `/opt/homebrew/opt/draco/lib/libdraco.9.dylib` dependency plus system libc++/libSystem. JHDF5 jar includes aarch64-Mac OS X native resource. The health request invokes actual native segment-id scanning after Redis PING; a 200 confirms this JNI constructor/self-test, not every codec or HDF5 method.

## Prepare without starting services

From the rust worktree root:

```sh
python3 backend-rust/tools/datastore_replay/prepare_scala.py \
  --artifacts-root /Users/therold/Programming/scalableminds/webknossos \
  --source-root "$PWD" \
  --output /tmp/wk-scala-replay-new \
  --port 19491 --redis-port 19492 --wk-port 19493
```

Use a fresh disposable output directory and three distinct free ports. Preparation refuses existing output and anything outside `/tmp`, checks required compiled resources and missing classpath entries, writes isolated HOCON/classpath, `launch-command.sh` and structured `launch-command.json` argv, and never starts services. The HOCON includes the **worktree's authoritative standalone-datastore.conf by absolute file path**, then overrides loopback addresses and temporary base data. It sets `play.http.router=router.Routes`, watcher/scan/upload off, no Slack or vault credentials, name `scala-replay-isolated`, key `isolated-replay-key`, and WK stub at loopback19493. It does not read root application.conf or any secret environment dump.

Optional `--datastore-name replay-ds --data-root /tmp/wk-ds6-fixtures/datasets --key-env WK_REPLAY_FIXTURE_KEY` reuses an existing copied fixture directory under `/tmp` and takes the shared fixture key from that named environment variable. Missing/empty selected key fails preparation; no flag retains the public test-only key `isolated-replay-key`. The generated config has mode600. Key is absent from process argv and launcher JSON; the parent harness can load `launch-command.json` and use `subprocess.Popen(argv)` without shell parsing. Source the fixture key without shell tracing; never print it.

Copy only selected disposable fixtures into `<output>/binaryData/<organization>/...` before replay. Do not symlink production writable directories. Watcher off does not disable unconditional delayed upload cleanup; empty/copy-only data and isolated Redis are required. Status reporting begins after 10s and must reach only the isolated WK stub.

## Parent-owned explicit launch

First check the selected ports with `lsof -nP -iTCP:19491 -iTCP:19492 -iTCP:19493 -sTCP:LISTEN`. Pick different ports on conflicts; never stop the existing listener. Start a separate Redis instance bound to loopback with persistence off and a unique data directory (no production config):

```sh
mkdir -p /tmp/wk-scala-replay-new/redis
redis-server --bind 127.0.0.1 --port 19492 \
  --dir /tmp/wk-scala-replay-new/redis --save '' --appendonly no \
  > /tmp/wk-scala-replay-new/redis.log 2>&1 &
REPLAY_REDIS_PID=$!
```

Start the parent-owned WK fixture server on19493 before Play. It must at least accept `PATCH /api/datastores/scala-replay-isolated/status?key=isolated-replay-key` with JSON `{ok:true,url:"http://127.0.0.1:19491"}` and answer a 2xx. For authenticated replay, add the exact access/data-source/credential/report fixture endpoints in `wk_client.rs`/Scala `DSRemoteWebknossosClient.scala`; do not forward requests to a production WK URI. Health/buildinfo alone need no user access endpoint.

```sh
sh /tmp/wk-scala-replay-new/launch-command.sh \
  > /tmp/wk-scala-replay-new/scala.log 2>&1 &
REPLAY_SCALA_PID=$!
curl --fail --silent --show-error http://127.0.0.1:19491/data/health
curl --fail --silent --show-error http://127.0.0.1:19491/api/buildinfo
```

The actual command is `java -Xms256m -Xmx2g -Dconfig.file=<isolated.conf> -Dplay.http.router=router.Routes -cp <237-entry classpath> play.core.server.ProdServerStart <temporary-output-root>`. No sbt server/build is needed for these existing artifacts. Shell-check succeeded for generated launcher. Once replay ends, parent terminates only PIDs started for this replay with SIGTERM and waits for them; never broad-match kill a live JVM/Redis.

## Play/Guice startup dependencies and routes

`DataStoreModule` binds eager config/access/health/threadpool/source/vault/upload/WK-RPC/cache/mapping/mesh/segment-index/connectome/S3-holder/Redis services. Built-in Play Guice supplies actor system, lifecycle, controller components, execution context and AHC WS; keep jar reference configs on classpath. This standalone datastore module does not require PostgreSQL or a FossilDB process for health/buildinfo. Tracingstore-dependent HTTP operations still need the fixture's actual tracingstore endpoints and suitable configured metadata.

Standalone top router `webknossos-datastore/conf/routes` includes `/data/ -> datastore.versioned.Routes` plus `/api/buildinfo`; versioned routes include v10–v16/latest and legacy overrides. `DsRequestHandler` serves `/` and `/index.html`, preflight and version validation. Include neither the main application `router.Routes` nor tracingstore top router on classpath; duplicate top routers/configs can accidentally start the wrong service.

If startup fails, retain isolated log, classify missing compiled product/Guice class/config/native resource, and coordinate prerequisites with parent. Do not invoke `sbt compile/stage/run` while another build owns target directories. A rebuild must use the same authoritative Scala sources and scoped datastore project; no schema bootstrap or production configuration is needed. Launch success is not datastore behavioral parity or production cutover.
