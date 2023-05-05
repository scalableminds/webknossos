# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.1...HEAD)
- FossilDB needs to be opened with new additional column families editableMappingsInfo, editableMappingsAgglomerateToGraph, editableMappingsSegmentToAgglomerate.
  - For instances with existing editable mapping (a.k.a supervoxel proofreading) annotations: To keep those annotations alive, a python migration has to be run with access to your tracingstore’s FossilDB. It is recommended to do this during a webknossos downtime to avoid data loss. It needs python 3.8+ and the pip packages installable by `pip install grpcio-tools grpcio-health-checking`. Run it with `python tools/migrate-editable-mappings/migrate-editable-mappings.py -v -w -o localhost:7155`. Omit -o for a faster migration but no access to older versions of the editable mappings. The migration is idempotent.
- The datastore now needs `brotli`. For Debian-based systems, this can be installed with `apt-get install libbrotli1`.
 
### Postgres Evolutions:
