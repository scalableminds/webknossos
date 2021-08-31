# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased

- For webknossos.org: Change `publicDemoDatasetUrl` in the `features`-block within `application.conf` to be an actionable URL. For example, append `/createExplorative/hybrid?fallbackLayerName=segmentation` to the URL so that a new annotation is created if a user clicks on `Open a Demo Dataset` in the dashboard.

### Postgres Evolutions:
