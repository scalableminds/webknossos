# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.01.0...HEAD)

### Postgres Evolutions:

- [094-pricing-plans.sql](conf/evolutions/reversions/094-pricing-plans.sql)
- [095-constraint-naming.sql](conf/evolutions/reversions/095-constraint-naming.sql)
- [096-storage.sql](conf/evolutions/096-storage.sql)
- [097-credentials.sql](conf/evolutions/097-credentials.sql)
- [098-voxelytics-states.sql](conf/evolutions/098-voxelytics-states.sql)
