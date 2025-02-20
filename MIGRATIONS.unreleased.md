# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.01.0...HEAD)
- config options `proxy.prefix` and `proxy.routes` were renamed to `aboutPageRedirect.prefix` and `aboutPageRedirect.routes` (as we no longer proxy, but redirect). [#8344](https://github.com/scalableminds/webknossos/pull/8344)
- The migration route `addSegmentIndex` was removed. If you haven’t done this yet, but need segment indices for your volume annotations, upgrade to an earlier version first, call addSegmentIndex, and then upgrade again. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
- The versioning scheme of annotations has been changed. That requires a larger migration including the FossilDB content. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
     - The FossilDB content needs to be migrated. For that, use the python program at `tools/migration-unified-annotation-versioning` (see python main.py --help for instructions). Note that it writes to a completely new FossilDB, that must first be opened with the new column families, see below. The migration code needs to connect to postgres, to the old FossilDB and to the new. After the migration, replace the old FossilDB by the new one (either change the ports of the existing programs, or exchange the data directories on disk).
    - For the migration, a second FossilDB needs to be started. To do that, either use the docker image, a jar, or checkout the [fossilDB repository](https://github.com/scalableminds/fossildb). If you opened your old FossilDB with an options file, it probably makes sense to use the same options file for the new one as well.
    - New FossilDB version `0.1.34` (docker image `scalableminds/fossildb:master__510`) is required. Start both the source and target FossilDBs with this new version.
    - (Target) FossilDB must now be opened with new column family set `skeletons,volumes,volumeData,volumeSegmentIndex,editableMappingsInfo,editableMappingsAgglomerateToGraph,editableMappingsSegmentToAgglomerate,annotations,annotationUpdates`.
    - For large databases, the migration may take multiple hours or even days. To avoid long downtimes, the migration can also be run in several incremental steps so that the majority of the data can already be migrated while WEBKNOSSOS is still running. Then only annotations that have been edited again since the first run need to be migrated in the incremental second run during a WEBKNOSSOS downtime.
    - Example command for the migration: `PG_PASSWORD=myPassword python main.py --src localhost:7500 --dst localhost:7155 --num_threads 20 --postgres webknossos@localhost:5430/webknossos`

### Postgres Evolutions:

- [126-add-webauthn-credentials.sql](./conf/evolutions/126-add-webauthn-credentials.sql)
