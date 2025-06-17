# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.06.1...HEAD)

- The default thread pool size was increased from 5 to 10 times the number of available CPUs (capped at 1000). Note that wk may need slightly more memory because of this. [#8686](https://github.com/scalableminds/webknossos/pull/8686)

### Postgres Evolutions:
- [134-dataset-layer-attachments.sql](conf/evolutions/134-dataset-layer-attachments.sql)
- [135-neuroglancer-attachment.sql](conf/evolutions/135-neuroglancer-attachment.sql)
