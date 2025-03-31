# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.02.1...HEAD)

 - FossilDB now needs to be opened with additional column family `skeletonTreeBodies`. [#8423](https://github.com/scalableminds/webknossos/pull/8423)

### Postgres Evolutions:
- [126-mag-real-paths.sql](conf/evolutions/126-mag-real-paths.sql)
- [127-job-retried-by-super-user.sql](conf/evolutions/127-job-retried-by-super-user.sql)
- [128-allow-ai-model-sharing.sql](conf/evolutions/128-allow-ai-model-sharing.sql)
- [129-credit-transactions.sql](conf/evolutions/129-credit-transactions.sql)
- [130-replace-text-types.sql](conf/evolutions/130-replace-text-types.sql)

