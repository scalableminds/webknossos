# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.06.0...HEAD)

 - Note that this upgrade can not be trivially rolled back, since new rocksDB column families are added and it is not easy to remove them again from an existing database. [#6195](https://github.com/scalableminds/webknossos/pull/6195)

### Postgres Evolutions:
