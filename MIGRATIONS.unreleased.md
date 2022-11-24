# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.2...HEAD)

- Bulk task creation now needs the taskTypeId, the task type summary will no longer be accepted. If you have scripts generating CSVs for bulk task creation, they should not output task type summaries. [#6640](https://github.com/scalableminds/webknossos/pull/6640)

### Postgres Evolutions:
