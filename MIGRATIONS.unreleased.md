# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.05.0...HEAD)

- Edited the annotations table to add the option to locked explorative annotations. Migration 114 needs to be executed to update the database schema.

### Postgres Evolutions:
- [114-annotation-locked-by-user.sql](conf/evolutions/114-annotation-locked-by-user.sql)