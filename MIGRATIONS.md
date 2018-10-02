# Migration Guide
All migrations of webknossos are documented in this file.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.md).

## Unreleased
- There is now a separate module for the tracing store, the datastore is no longer responsible for saving tracings. This module can run as a standalone application, or as a module of webknossos locally. It is recommended that you chose the option that was previously also in place for datastores. In case of a standalone datastore, the local one needs to be disabled in application.conf: `tracingstore.enabled = false` and `play.modules.disabled += "com.scalableminds.braingames.datastore.TracingStoreModule` – and in either case, the adress of the tracingstore (localhost or remote) needs to be inserted in the db in `webknossos.tracingStores`
### Postgres Evolutions:
- [027-drop-dataset-name-unique-constraint.sql](conf/evolutions/027-drop-dataset-name-unique-constraint.sql)
- [028-tracingstore.sql](conf/evolutions/028-tracingstore.sql)


## [18.10.0](https://github.com/scalableminds/webknossos/releases/tag/18.10.0) - 2018-09-22
### Postgres Evolutions:
- [022-add-foreign-datastore.sql](conf/evolutions/022-add-foreign-datastore.sql)
- [023-drop-datastore-type.sql](conf/evolutions/023-drop-datastore-type.sql)
- [024-drop-md5hash.sql](conf/evolutions/024-drop-md5hash.sql)
- [025-add-dataset-sortingKey.sql](conf/evolutions/025-add-dataset-sortingKey.sql)
- [026-decrease-total-instance.sql](conf/evolutions/026-decrease-total-instance.sql)

### Configuration Changes:
- some keys in `application.conf` have changed, if you overwrite them in your setup, please adapt: `application.secret` is now `play.http.secret.key`, `postgres.*` is now `slick.db.*`
- Logger configuration has been simplified. Webknossos no longer comes with multiple logger config xmls, so if your setup selected a specific one of these, that needs to be removed (or a custom file needs to be supplied). Same for standalone datastore.

### Data Migrations:
- Use `tools/volumeAddFallbackLayer.py` to add a fallback segmentation layer to existing volume tracing zip files (also compare CHANGELOG.md).


## [18.09.0](https://github.com/scalableminds/webknossos/releases/tag/18.09.0) - 2018-08-20
### Postgres Evolutions:
- [018-hybrid-annotations.sql](conf/evolutions/018-hybrid-annotations.sql)
- [019-dataset-lastusedtime.sql](conf/evolutions/019-dataset-lastusedtime.sql)
- [021-list-experiences.sql](conf/evolutions/021-list-experiences.sql)


## [18.08.0](https://github.com/scalableminds/webknossos/releases/tag/18.08.0) - 2018-07-23
### Postgres Evolutions:
- [013-add-logoUrl.sql](conf/evolutions/013-add-logoUrl.sql)
- [014-equalize-schema-and-evolutions.sql](conf/evolutions/014-equalize-schema-and-evolutions.sql)
- [015-add-organization-displayname.sql](conf/evolutions/015-add-organization-displayname.sql)
- To clean up half-deleted tasks as caused by [this bug](https://github.com/scalableminds/webknossos/issues/2873), run `update webknossos.annotations set isDeleted = true where _id in (select a._id from webknossos.annotations_ a join webknossos.tasks t on a._task = t._id where t.isDeleted and a.typ == 'Task')`
- [016-add-schema-version.sql](conf/evolutions/016-add-schema-version.sql)
- [017-add-organization-email.sql](conf/evolutions/017-add-organization-email.sql)
- Add email addresses for notifications about new users and about task overtime to the `webknossos.organizations` entries in the Postgres database (previously in `application.conf` > `braintracing.newuserlist` and `braintracing.overTimeList`)


## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05
First release
