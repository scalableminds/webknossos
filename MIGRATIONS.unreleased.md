# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased

- The docker files now place the webKnossos installation under `/webknossos` instead of `/srv/webknossos`. All mounts, most importantly `/srv/webknossos/binaryData`, need to be changed accordingly.
- The entrypoint of the docker files have changed. Therefore, any existing `docker-compose.yml` setups need to be adapted. In most cases, only the `entrypoint: bin/webknossos` lines need to be removed (if existant).
- To receive Slack notifications about slow bucket requests, overwrite `slackNotifications.uri` in the webknossos-datastore config.
- The datastore now also needs access to a Redis database. New config fields `datastore.redis.address` and `datastore.redis.port` are required. Note that this Redis instance may be the same one the tracingstore uses, but does not have to be.

### Postgres Evolutions:

- 
