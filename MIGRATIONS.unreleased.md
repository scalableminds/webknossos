# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased

[Commits](https://github.com/scalableminds/webknossos/compare/24.04.0...HEAD)

- Changed some internal APIs to use spelling dataset instead of dataSet. This requires all connected datastores to be the latest version. [#7690](https://github.com/scalableminds/webknossos/pull/7690)

### Postgres Evolutions:
