# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.12.0...HEAD)
- Removed support for HTTP API versions 3 and 4. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- New FossilDB version `0.1.33` (docker image `scalableminds/fossildb:master__504`) is required.
- Datastore config options `datastore.baseFolder` and `localFolderWhitelist` to `datastore.baseDirectory` and `localDirectoryWhitelist` respectively, to avoid confusion with the dashboard folders. [#8292](https://github.com/scalableminds/webknossos/pull/8292)
- config options `proxy.prefix` and `proxy.routes` were renamed to `aboutPageRedirect.prefix` and `aboutPageRedirect.routes` (as we no longer proxy, but redirect). [#8344](https://github.com/scalableminds/webknossos/pull/8344)

### Postgres Evolutions:
- [124-decouple-dataset-directory-from-name](conf/evolutions/124-decouple-dataset-directory-from-name)
