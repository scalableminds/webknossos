# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.06.0...HEAD)

- The datastore config field `datastore.cache.dataCube.maxEntries` is no longer used an can be removed.

### Postgres Evolutions:

- [114-ai-models.sql](conf/evolutions/114-ai-models.sql)
- [115-annotation-locked-by-user.sql](conf/evolutions/115-annotation-locked-by-user.sql)
- [116-drop-overtimemailinglist.sql](conf/evolutions/116-drop-overtimemailinglist.sql)
- [117-voxel-size-unit.sql](conf/evolutions/117-voxel-size-unit.sql)
