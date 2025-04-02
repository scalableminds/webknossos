# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.03.0...HEAD)

### Postgres Evolutions:
- [129-credit-transactions.sql](conf/evolutions/129-credit-transactions.sql)
- [130-replace-text-types.sql](conf/evolutions/130-replace-text-types.sql)
