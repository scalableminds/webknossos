# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased

- If your setup includes a webknossos-worker, it needs to be updated to the latest version (PR https://github.com/scalableminds/webknossos-worker/pull/70)

### Postgres Evolutions:

- [077-workers.sql](conf/evolutions/077-workers.sql)
