# Migration Guide

All migrations of webKnossos are documented in this file.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`. User-facing changes are documented in the [changelog](changelog.md).

## Unreleased

-

### Postgres Evolutions:

* [036-add-lastTaskTypeId-to-user.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/036-add-lastTaskTypeId-to-user.sql)

## [18.12.0](https://github.com/scalableminds/webknossos/releases/tag/18.12.0) - 2018-11-26

* If additional dataset directories were watched using the config key `additionalFolders`, those symlinks are no longer updated. Consider setting up additional datastores for these directories respectively.

### Postgres Evolutions:

* [033-tasktype-recommendedConfiguration.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/033-tasktype-recommendedConfiguration.sql)
* [034-meshes.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/034-meshes.sql)
* [035-add-annotation-dataset-foreign-key.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/035-add-annotation-dataset-foreign-key.sql)

## [18.11.0](https://github.com/scalableminds/webknossos/releases/tag/18.11.0) - 2018-10-29

* Some config keys have changed, if you overwrite them in your setup, please adapt: the `oxalis` prefix is renamed to `webKnossos` so the new keys are `webKnossos.user.time.tracingPauseInSeconds`, `webKnossos.tasks.maxOpenPerUser`, `webKnossos.newOrganizationMailingList` as well as `datastore.webKnossos.uri`, `datastore.webKnossos.secured`, `datastore.webKnossos.pingIntervalMinutes` for the data store.
* There is now a separate module for the tracingstore, the datastore is no longer responsible for saving tracings. This module can run as a standalone application, or as a module of webKnossos locally. It is recommended that you choose the option that was previously also in place for datastores. In case of a standalone datastore, the local one needs to be disabled in application.conf: `tracingstore.enabled = false` and `play.modules.disabled += "com.scalableminds.braingames.datastore.TracingStoreModule` – and in either case, the adress of the tracingstore \(localhost or remote\) needs to be inserted in the db in `webknossos.tracingStores`.
* The FossilDB version has changed from `0.1.10` to `0.1.14`.
* The FossilDB needs to be run with an additional column family `volumeUpdates`.
* If your setup overwrites the config key `play.http.router` to disable the local datastore, change it to `"noDS.Routes"` \(or `"noDS.noTS.Routes"` to also disable the local tracingstore\).

#### Postgres Evolutions:

* [027-drop-dataset-name-unique-constraint.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/027-drop-dataset-name-unique-constraint.sql)
* [028-add-isBlacklistedFromReport.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/028-add-isBlacklistedFromReport.sql)
* [029-foreign-keys-deferrable.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/029-foreign-keys-deferrable.sql)
* [030-tracingstore.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/030-tracingstore.sql)
* [031-maintenance.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/031-maintenance.sql)
* [032-scratch-datastores.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/032-scratch-datastores.sql)

## [18.10.0](https://github.com/scalableminds/webknossos/releases/tag/18.10.0) - 2018-09-22

### Postgres Evolutions:

* [022-add-foreign-datastore.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/022-add-foreign-datastore.sql)
* [023-drop-datastore-type.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/023-drop-datastore-type.sql)
* [024-drop-md5hash.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/024-drop-md5hash.sql)
* [025-add-dataset-sortingKey.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/025-add-dataset-sortingKey.sql)
* [026-decrease-total-instance.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/026-decrease-total-instance.sql)

### Configuration Changes:

* some keys in `application.conf` have changed, if you overwrite them in your setup, please adapt: `application.secret` is now `play.http.secret.key`, `postgres.*` is now `slick.db.*`
* Logger configuration has been simplified. Webknossos no longer comes with multiple logger config xmls, so if your setup selected a specific one of these, that needs to be removed \(or a custom file needs to be supplied\). Same for standalone datastore.

### Data Migrations:

* Use `tools/volumeAddFallbackLayer.py` to add a fallback segmentation layer to existing volume tracing zip files \(also compare CHANGELOG.md\).

## [18.09.0](https://github.com/scalableminds/webknossos/releases/tag/18.09.0) - 2018-08-20

### Postgres Evolutions:

* [018-hybrid-annotations.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/018-hybrid-annotations.sql)
* [019-dataset-lastusedtime.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/019-dataset-lastusedtime.sql)
* [021-list-experiences.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/021-list-experiences.sql)

## [18.08.0](https://github.com/scalableminds/webknossos/releases/tag/18.08.0) - 2018-07-23

### Postgres Evolutions:

* [013-add-logoUrl.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/013-add-logoUrl.sql)
* [014-equalize-schema-and-evolutions.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/014-equalize-schema-and-evolutions.sql)
* [015-add-organization-displayname.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/015-add-organization-displayname.sql)
* To clean up half-deleted tasks as caused by [this bug](https://github.com/scalableminds/webknossos/issues/2873), run `update webknossos.annotations set isDeleted = true where _id in (select a._id from webknossos.annotations_ a join webknossos.tasks t on a._task = t._id where t.isDeleted and a.typ == 'Task')`
* [016-add-schema-version.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/016-add-schema-version.sql)
* [017-add-organization-email.sql](https://github.com/scalableminds/webknossos/tree/55640d5e576904a96e0c2e5fe150d5e119bfa7c1/conf/evolutions/017-add-organization-email.sql)
* Add email addresses for notifications about new users and about task overtime to the `webknossos.organizations` entries in the Postgres database \(previously in `application.conf` &gt; `braintracing.newuserlist` and `braintracing.overTimeList`\)

## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05

First release

