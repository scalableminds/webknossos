# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- The optional `defaultOrganization` attribute from the `features` block in `application.conf` is not used anymore and can be removed. [#4559](https://github.com/scalableminds/webknossos/pull/4559)

### Postgres Evolutions:

