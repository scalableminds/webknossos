# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- The optional `defaultOrganization` attribute from the `features` block in `application.conf` is not used anymore and can be removed. [#4559](https://github.com/scalableminds/webknossos/pull/4559)

### Postgres Evolutions:

## [20.04.0](https://github.com/scalableminds/webknossos/releases/tag/20.04.0) - 2020-03-23
- Default interval for detecting new/deleted datasets on disk (`braingames.binary.changeHandler.tickerInterval` in the config) has been reduced from 10 to 1 minute. If you relied on the value being 10 minutes, you have to set it explicitly now.

### Postgres Evolutions:
- [051-add-source-view-configuration.sql](conf/evolutions/051-add-source-view-configuration.sql)
- [052-replace-segmentation-opacity.sql](conf/evolutions/052-replace-segmentation-opacity.sql)

## [20.03.0](https://github.com/scalableminds/webknossos/releases/tag/20.03.0) - 2020-02-27
No migrations necessary.

## [20.2.0](https://github.com/scalableminds/webknossos/releases/tag/20.2.0) - 2020-01-27
### Postgres Evolutions:
- [050-add-annotation-visibility-enum.sql](conf/evolutions/050-add-annotation-visibility-enum.sql)

## [20.1.0](https://github.com/scalableminds/webknossos/releases/tag/20.1.0) - 2020-01-08
- The initial organization was renamed to `sample_organization`. Make sure to move the data over or to put a symlink in place.
- The default `operatorData` was replaced. Make sure to update with valid information for public deployments.
- The config `uri` has been refactored. Pairs of `uri` and `secured` have been replaced with just `uri` which now requires a `http://` or `https://` prefix.

### Postgres Evolutions:
- [049-annotation-listed-teams.sql](conf/evolutions/049-annotation-listed-teams.sql)

