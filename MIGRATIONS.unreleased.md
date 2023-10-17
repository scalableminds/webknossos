# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.2...HEAD)

 - In order to enable segment statistics for existing volume annotations (without fallback segmentation), a user with superuser rights can call a migration route. This will transform all volume annotation layers that qualify (cross organization). This will take some time, results will be logged by WEBKNOSSOS to stdout. The trigger route is `curl -X PATCH "<domain>/api/annotations/addSegmentIndicesToAll?parallelBatchCount=16" -H 'X-Auth-Token: <token>'` with the `parallelBatchCount` parameter controlling the parallelity of the migration (e.g. number of cpu cores of the tracingstore server).

### Postgres Evolutions:
