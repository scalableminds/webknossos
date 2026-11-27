# DS6 actual Scala datastore launch investigation

## Status

2026-10-12: preparation and executable recipe DONE; actual service launch/replay parent-owned and not yet claimed. No services/builds started and existing JVMs untouched. Own files: tools/datastore_replay/{prepare_scala.py,scala-launch.md} and this checkpoint.

## Done

- Found canonical cached runtime exports and Scala3.8.4 datastore/util/JNI classes; rust worktree has no Scala targets.
- Assembled 237 existing classpath entries from internal+managed+unmanaged runtime exports (234 jars +3 class dirs); safely omitted absent optional assets directory. Excludes mainapp/tracingstore products.
- Confirmed compiled datastore router, request handler/module, standalone resource, Play server main class and Guice/AHC/Pekko jars. Source equivalence check: 283 tracked source/config/build files canonical versus rust worktree; zero differences.
- Inspected JNI arm64 resource and linkage: libwebknossosJni0 resource, present Homebrew libdraco.9 dependency. JHDF5 has aarch64 Mac native resource. Health invokes real native bucket scanner test.
- Preparation helper validates disposable new /tmp output, distinct unprivileged ports, cached products/config; writes explicit isolated launch command but never runs it. Includes worktree standalone config, temporary data, isolated loopback Redis/WK/public URI, watcher/scan/upload off, no Slack/global credentials.
- Added parent-requested optional datastore name, existing temporary copied data root, key from named environment variable and JSON subprocess argv; config chmod600, key never in argv. Override preparation tested against disposable existing directory.
- Documented eager Guice services, actual standalone route hierarchy, required WK stub status callback, delayed cleanup risk, exact java invocation, build/native diagnosis and parent-only launch/teardown.

## Next

- Parent start new isolated Redis/WK fixture then run generated launcher and record Guice/JNI health/buildinfo result before actual differential replay.
- Runtime source equivalence does not prove cached-bytecode freshness; record artifact provenance or coordinate rebuild if evidence demands it. No production/deployment/parity conclusion.

## Evidence

- Prepared `/private/tmp/wk-scala-launch-inspection-source-20261012` with ports19491/19492/19493 and canonical artifact root/worktree source root; 237 entries validated. `sh -n launch-command.sh` passes.
- No sbt build/compile/native load/server execution performed. Source/native/jar inspection only; no secret/environment dumps.
- Scala references build.sbt datastore dependsOn(util,JNI); project/Dependencies.scala; DataStoreModule.scala; DsRequestHandler.scala; conf/routes; Application.scala; NativeBucketScanner.scala; DataSourceService.scala/DSRemoteWebknossosClient.scala/UploadService.scala.
