# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.07.0...HEAD)

- If Segment Anything was already configured, it needs to be pointed to an endpoint that works with SAM 2. [#7965](https://github.com/scalableminds/webknossos/pull/7965)

### Postgres Evolutions:
- [119-add-metadata-to-folders-and-datasets.sql](conf/evolutions/119-add-metadata-to-folders-and-datasets.sql)
- [120-remove-old-organization-id.sql](conf/evolutions/120-remove-old-organization-id.sql)
