# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.05.0...HEAD)

- If your setup contains webknossos-workers, you may want to add the new available job `align_sections` to the `supportedJobCommands` of your workers. Make sure you deploy the latest webknossos-worker release. [#7820](https://github.com/scalableminds/webknossos/pull/7820)

### Postgres Evolutions:
