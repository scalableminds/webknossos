# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.12.0...HEAD)
- Removed support for HTTP API versions 3 and 4. [#8075](https://github.com/scalableminds/webknossos/pull/8075)

### Postgres Evolutions:
- [124-decouple-dataset-directory-from-name](conf/evolutions/124-decouple-dataset-directory-from-name)
