# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- WKW datasets can now only be read if they have a `header.wkw` file in their mag directories. If specific datasets can no longer be loaded, consider adding such a file. Backend logging should show according error message. [#7528](https://github.com/scalableminds/webknossos/pull/7528)

### Postgres Evolutions:

- [113-analytics-events.sql](conf/evolutions/113-analytics-events.sql)
