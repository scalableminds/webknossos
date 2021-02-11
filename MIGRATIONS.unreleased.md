# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- Support for KNOSSOS cubes data format was removed. Use the [webKnossos cuber](https://github.com/scalableminds/webknossos-cuber) tool to convert existing datasets saved as KNOSSOS cubes.
- Multi-organization instances only: user experience domains are now separated per organization. After postgres evolution 64 (see below), make sure to move existing experience domains to the correct organization in the database. (The evolution just selects any one from the database).

### Postgres Evolutions:
- [061-userinfos-view.sql](conf/evolutions/061-userinfos-view)
- [062-dataset-uploader.sql](conf/evolutions/062-dataset-uploader.sql)
- [063-novelUserExperienceinfos.sql](conf/evolutions/063-novelUserExperienceinfos.sql)
- [064-experienceDomains-per-orga.sql](conf/evolutions/064-experienceDomains-per-orga.sql)
- [065-unlisted-superusers.sql](conf/evolutions/065-unlisted-superusers.sql)
