# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.08.0...HEAD)

- webKnossos requires node 16 now. [#6350](https://github.com/scalableminds/webknossos/pull/6350)
- Removed the foreign datastore feature. If you have any foreign datastores registered in your webKnossos, running this upgrade may result in undefined behavior. [#6392](https://github.com/scalableminds/webknossos/pull/6392)

### Postgres Evolutions:
- [084-annotation-contributors.sql](conf/evolutions/084-annotation-contributors.sql)
- [085-add-annotations-publicationforeignkey](conf/evolutions/085-add-annotations-publicationforeignkey.sql)
- [086-drop-foreign-datastores.sql](conf/evolutions/086-drop-foreign-datastores.sql.sql)
- [087-zarr-private-links](conf/evolutions/087-zarr-private-links.sql)
