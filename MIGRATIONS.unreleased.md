# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.02.0...HEAD)
- The config field `googleAnalytics.trackingId` needs to be changed to [GA4 measurement id](https://support.google.com/analytics/answer/10089681), if used.

### Postgres Evolutions:
- [081-annotation-viewconfiguration.sql](conf/evolutions/081-annotation-viewconfiguration.sql)
