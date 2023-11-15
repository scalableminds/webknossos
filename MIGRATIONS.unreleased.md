# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.11.0...HEAD)

- If your deployment starts FossilDB separately, make sure to upgrade to version 0.1.27 (build master__484). Note that with the upgraded version, the database contents are automatically migrated. A downgrade to an older FossilDB version is not possible afterwards (creating an additional backup of the FossilDB data directory is advised)
- The config `setting play.http.secret.key` (secret random string) now requires a minimum length of 32 bytes.

### Postgres Evolutions:
