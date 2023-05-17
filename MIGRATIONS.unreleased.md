# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.2...HEAD)
- FossilDB needs to be opened with new additional column families editableMappingsInfo, editableMappingsAgglomerateToGraph, editableMappingsSegmentToAgglomerate.
- For instances with existing editable mapping (a.k.a supervoxel proofreading) annotations: To keep those annotations alive, a python migration has to be run with access to your tracingstore’s FossilDB. It is recommended to do this during a webknossos downtime to avoid data loss. It needs python 3.8+ and the pip packages installable by `pip install grpcio-tools grpcio-health-checking`. Run it with `python tools/migrate-editable-mappings/migrate-editable-mappings.py -v -w -o localhost:7155`. Omit -o for a faster migration but no access to older versions of the editable mappings. The migration is idempotent.
- The datastore now needs `brotli`. For Debian-based systems, this can be installed with `apt-get install libbrotli1`.
- New FossilDB version 0.1.23 (`master__448` on Dockerhub) is required, compare [FossilDB PR](https://github.com/scalableminds/fossildb/pull/38).
- Support for [webknososs-connect](https://github.com/scalableminds/webknossos-connect) data store servers has been removed. Please remove the database entries for such datastores and the corresponding datasets and annotations. If you need to keep the datasets, consider adding them to a regular datastore using the same name. If the webknossos datastore does not support the dataset format, it may make sense to manually move the datasets to an existing datastore in the database, to avoid breaking foreign key relations. They will then be shown as “no longer available on the datastore”. [#7031](https://github.com/scalableminds/webknossos/pull/7031)

### Postgres Evolutions:
