# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.12.0...HEAD)
- Removed support for HTTP API versions 3 and 4. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- The migration route `addSegmentIndex` was removed. If you haven’t done this yet, but need segment indices for your volume annotations, upgrade to an earlier version first, call addSegmentIndex, and then upgrade again. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
- The versioning scheme of annotations has been changed. That requires a larger migration including the FossilDB content. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
    - New FossilDB version is required # TODO
    - For the migration, a second FossilDB needs to be started. To do that, either use the docker image, a jar, or checkout the [fossilDB repository](https://github.com/scalableminds/fossildb). If you opened your old FossilDB with an options file, it probably makes sense to use the same options file for the new one as well.
    - FossilDB must now be opened with new column family set `skeletons,volumes,volumeData,volumeSegmentIndex,editableMappingsInfo,editableMappingsAgglomerateToGraph,editableMappingsSegmentToAgglomerate,annotations,annotationUpdates`. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
    - The FossilDB content needs to be migrated. For that, use the python program at `tools/migration-unified-annotation-versioning` (see python main.py --help for instructions). Note that it writes to a completely new FossilDB, that must first be opened with the new column families, see above. The migration code needs to connect to postgres, to the old FossilDB and to the new. After the migration, replace the old FossilDB by the new one (either change the ports of the existing programs, or exchange the data directories on disk). The migration can also be run in several steps so that the majority of the data can already be migrated while WEBKNOSSOS is still running. Then only annotations that have been edited again since the first run need to be migrated in the incremental second run during a WEBKNOSSOS downtime. [#7917](https://github.com/scalableminds/webknossos/pull/7917)

### Postgres Evolutions:
- [124-decouple-dataset-directory-from-name](conf/evolutions/124-decouple-dataset-directory-from-name)
