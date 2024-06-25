# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.06.0...HEAD)

- The datastore config field `datastore.cache.dataCube.maxEntries` is no longer used an can be removed. [#7818](https://github.com/scalableminds/webknossos/pull/7818)
- If your setup contains webknossos-workers, you may want to add the newly available job `align_sections` to the `supportedJobCommands` of your workers. Make sure you deploy the latest webknossos-worker release. [#7820](https://github.com/scalableminds/webknossos/pull/7820)
- If you place WKW datasets directly on disk, a datasource-properties.json is now required, as WEBKNOSSOS no longer guesses its contents from the raw data. Standard dataset creation methods, e.g. with the WEBKNOSSOS CLI or python libs will already automatically this metadata file. [#7697](https://github.com/scalableminds/webknossos/pull/7697)

### Postgres Evolutions:

- [114-ai-models.sql](conf/evolutions/114-ai-models.sql)
- [115-annotation-locked-by-user.sql](conf/evolutions/115-annotation-locked-by-user.sql)
- [116-drop-overtimemailinglist.sql](conf/evolutions/116-drop-overtimemailinglist.sql)
- [117-voxel-size-unit.sql](conf/evolutions/117-voxel-size-unit.sql)
