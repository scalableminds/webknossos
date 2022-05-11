# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.1...HEAD)

 - Note that the datastore API version has changed to 2.0. If you use webknossos-connect alongside your webKnossos instance, you will need to upgrade that one as well, compare [webknossos-connect#129](https://github.com/scalableminds/webknossos-connect/pull/129). [#6159](https://github.com/scalableminds/webknossos/pull/6159)

### Postgres Evolutions:
- [082-annotationsettings-volumeInterpolationAllowed.sql](conf/evolutions/082-annotationsettings-volumeInterpolationAllowed.sql)
