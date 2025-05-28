# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.05.1...HEAD)

### Postgres Evolutions:

- [131-more-indices-on-users.sql](conf/evolutions/131-more-indices-on-users.sql)
- [132-remove-stored-meshes.sql](conf/evolutions/132-remove-stored-meshes.sql)
- [133-datasource-properties-in-db.sql](conf/evolutions/133-datasource-properties-in-db.sql)
- [134-dataset-layer-attachments.sql](conf/evolutions/134-dataset-layer-attachments.sql)
