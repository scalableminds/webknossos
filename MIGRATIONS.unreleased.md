# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.01.0...HEAD)

- WEBKNOSSOS requires Loki instead of Elasticsearch for Voxelytics logging now. Please update the `application.conf`: Remove `voxelytics.elasticsearch.index`, rename `voxelytics.elasticsearch` to `voxelytics.loki`, and update `voxelytics.loki.uri`. [#6770](https://github.com/scalableminds/webknossos/pull/6770)

### Postgres Evolutions:

- [094-pricing-plans.sql](conf/evolutions/reversions/094-pricing-plans.sql)
- [095-constraint-naming.sql](conf/evolutions/reversions/095-constraint-naming.sql)
- [096-storage.sql](conf/evolutions/096-storage.sql)
- [097-credentials.sql](conf/evolutions/097-credentials.sql)
- [098-voxelytics-states.sql](conf/evolutions/098-voxelytics-states.sql)
