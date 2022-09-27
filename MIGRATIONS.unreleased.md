# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.09.0...HEAD)

- To use the Voxelytics reporting features in webKnossos, the config field `features.voxelyticsEnabled` needs to be set to true. When also using the logging features, an Elasticsearch instance needs to be running and configured in the config field `voxelytics.elasticsearch.uri`.

### Postgres Evolutions:
- [089-cleanup.sql](conf/evolutions/089-cleanup.sql)
- [088-shortlinks.sql](conf/evolutions/088-shortlinks.sql)
- [089-voxelytics.sql](conf/evolutions/089-voxelytics.sql)
