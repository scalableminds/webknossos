# Migration Guide

All migrations of webknossos are documented in this file.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`. User-facing changes are documented in the [changelog](changelog.md).

## Unreleased

### Postgres Evolutions:

* [022-add-foreign-datastore.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/022-add-foreign-datastore.sql)
* [023-drop-datastore-type.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/023-drop-datastore-type.sql)
* [024-drop-md5hash.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/024-drop-md5hash.sql)
* [025-add-dataset-sortingKey.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/025-add-dataset-sortingKey.sql)
* some keys in `application.conf` have changed, if you overwrite them in your setup, please adapt: `application.secret` is now `play.crypto.secret`, `postgres.*` is now `slick.db.*`
* Use `tools/volumeAddFallbackLayer.py` to add a fallback segmentation layer to existing volume tracing zip files \(also compare CHANGELOG.md\).
* Logger configuration has been simplified. Webknossos no longer comes with multiple logger config xmls, so if your setup selected a specific one of these, that needs to be removed \(or a custom file needs to be supplied\). Same for standalone datastore.

## [18.09.0](https://github.com/scalableminds/webknossos/releases/tag/18.09.0) - 2018-08-20

### Postgres Evolutions:

* [018-hybrid-annotations.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/018-hybrid-annotations.sql)
* [019-dataset-lastusedtime.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/019-dataset-lastusedtime.sql)
* [021-list-experiences.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/021-list-experiences.sql)

## [18.08.0](https://github.com/scalableminds/webknossos/releases/tag/18.08.0) - 2018-07-23

### Postgres Evolutions:

* [013-add-logoUrl.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/013-add-logoUrl.sql)
* [014-equalize-schema-and-evolutions.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/014-equalize-schema-and-evolutions.sql)
* [015-add-organization-displayname.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/015-add-organization-displayname.sql)
* To clean up half-deleted tasks as caused by [this bug](https://github.com/scalableminds/webknossos/issues/2873), run `update webknossos.annotations set isDeleted = true where _id in (select a._id from webknossos.annotations_ a join webknossos.tasks t on a._task = t._id where t.isDeleted and a.typ == 'Task')`
* [016-add-schema-version.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/016-add-schema-version.sql)
* [017-add-organization-email.sql](https://github.com/scalableminds/webknossos/tree/7d7723b0b7267ddb1a04c17cc695df67cfefdd11/conf/evolutions/017-add-organization-email.sql)
* Add email addresses for notifications about new users and about task overtime to the `webknossos.organizations` entries in the Postgres database \(previously in `application.conf` &gt; `braintracing.newuserlist` and `braintracing.overTimeList`\)

## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05

First release

