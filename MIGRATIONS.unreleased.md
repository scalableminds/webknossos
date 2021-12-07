# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased

- The datastore now also needs access to a Redis database. New config fields `datastore.redis.address` and `datastore.redis.port` are required. Note that this Redis instance may be the same one the tracingstore uses, but does not have to be.

### Postgres Evolutions:
- [078-annotation-layers.sql](conf/evolutions/078-annotation-layers.sql)
- [079-add-dataset-tags.sql](conf/evolutions/079-add-dataset-tags.sql)
