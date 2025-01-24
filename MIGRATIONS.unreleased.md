# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- config options `proxy.prefix` and `proxy.routes` were renamed to `aboutPageRedirect.prefix` and `aboutPageRedirect.routes` (as we no longer proxy, but redirect). [#8344](https://github.com/scalableminds/webknossos/pull/8344)

### Postgres Evolutions:
