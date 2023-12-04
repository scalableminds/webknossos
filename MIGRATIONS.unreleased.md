# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.11.0...HEAD)

- If your deployment starts FossilDB separately, make sure to upgrade to version 0.1.27 (build master__484). Note that with the upgraded version, the database contents are automatically migrated. A downgrade to an older FossilDB version is not possible afterwards (creating an additional backup of the FossilDB data directory is advised)
- WEBKNOSSOS now sets the Content-Security-Policy (CSP) HTTP response header restricting which dynamic resources are allowed to load. Please update the `application.conf` - `play.filters.csp.directives` key if you'd like to change the default CSP. The default CSP is suited for WEBKNOSSOS development. For production follow the comments next to the respective directives in the `application.conf`, i.e. remove 'unsafe-inline' from the script-src, remove ws://localhost:9002 from the connect-src, add the URLs of all external datastores to the connect-src, and add the host domain to the connect-src. [#7367](https://github.com/scalableminds/webknossos/pull/7367) and [#7450](https://github.com/scalableminds/webknossos/pull/7450)
- 

### Postgres Evolutions:
