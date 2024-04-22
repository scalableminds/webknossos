# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased

[Commits](https://github.com/scalableminds/webknossos/compare/24.04.0...HEAD)

- Changed some internal APIs to use spelling dataset instead of dataSet. This requires all connected datastores to be the latest version. [#7690](https://github.com/scalableminds/webknossos/pull/7690)
- If your setup contains webknossos-workers, you may want to add the new available job `infer_mitochondria` to the `supportedJobCommands` of your workers. Make sure you deploy the latest webknossos-worker release. [#7752](https://github.com/scalableminds/webknossos/pull/7752)
- Meshfiles with version 2 or older are no longer supported. Talk to us about support in converting your old meshfiles. [#7764](https://github.com/scalableminds/webknossos/pull/7764)

### Postgres Evolutions:

- If your setup contains a worker, make sure to upgrade it to the latest version, as the authentication api has changed (user_auth_token rather than webknossos_token). [#6547](https://github.com/scalableminds/webknossos/pull/6547)
