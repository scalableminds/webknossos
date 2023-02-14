# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.02.1...HEAD)

- WEBKNOSSOS now requires Node.js not only for development and building, but also for execution. The prebuilt Docker images already contain this dependency. If you're using these, nothing needs to be changed. [#6803](https://github.com/scalableminds/webknossos/pull/6803)
- Requires Voxelytics worker version 23.02.xx for long-running jobs. [#6838](https://github.com/scalableminds/webknossos/pull/6838)

### Postgres Evolutions:
