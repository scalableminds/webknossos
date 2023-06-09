# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- Support for [webknososs-connect](https://github.com/scalableminds/webknossos-connect) data store servers has been removed. Please remove the database entries for such datastores and the corresponding datasets and annotations. If you need to keep the datasets, consider adding them to a regular datastore using the same name. If the webknossos datastore does not support the dataset format, it may make sense to manually move the datasets to an existing datastore in the database, to avoid breaking foreign key relations. They will then be shown as “no longer available on the datastore”. [#7032](https://github.com/scalableminds/webknossos/pull/7032)
- FossilDB needs to be opened with new additional column family volumeSegmentIndex.

### Postgres Evolutions:
