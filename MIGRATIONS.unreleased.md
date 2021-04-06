# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- Instances with long-running jobs only: the `tiff_cubing` job was renamed to `convert_to_wkw`. For old jobs to be listed properly, execute sql `update webknossos.jobs set command = 'convert_to_wkw' where command = 'tiff_cubing';`

### Postgres Evolutions:
- [068-pricing-plan.sql](conf/evolutions/068-pricing-plan.sql)
