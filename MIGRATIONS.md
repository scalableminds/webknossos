# Migration Guide
All migrations of webKnossos are documented in this file.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.md).

## Unreleased
-

### Postgres Evolutions:
-

## [20.2.0](https://github.com/scalableminds/webknossos/releases/tag/20.2.0) - 2020-01-27
No migrations necessary.

## [20.1.0](https://github.com/scalableminds/webknossos/releases/tag/20.1.0) - 2020-01-08
- The initial organization was renamed to `sample_organization`. Make sure to move the data over or to put a symlink in place.
- The default `operatorData` was replaced. Make sure to update with valid information for public deployments.
- The config `uri` has been refactored. Pairs of `uri` and `secured` have been replaced with just `uri` which now requires a `http://` or `https://` prefix.

### Postgres Evolutions:
- [049-annotation-listed-teams.sql](conf/evolutions/049-annotation-listed-teams.sql)
- [050-add-annotation-visibility-enum.sql](conf/evolutions/050-add-annotation-visibility-enum.sql)


## [19.12.0](https://github.com/scalableminds/webknossos/releases/tag/19.12.0) - 2019-11-25
No migrations necessary.

## [19.11.0](https://github.com/scalableminds/webknossos/releases/tag/19.11.0) - 2019-10-28
### Postgres Evolutions:
- [046-fix-missing-voxel-type.sql](conf/evolutions/046-fix-missing-voxel-type.sql)
- [047-add-datastore-publicUrl.sql](conf/evolutions/046-add-datastore-publicUrl.sql)
- [048-add-tracingstore-publicUrl.sql](conf/evolutions/047-add-tracingstore-publicUrl.sql)

## [19.10.0](https://github.com/scalableminds/webknossos/releases/tag/19.10.0) - 2019-09-30
### Postgres Evolutions:
- [045-annotationsettings-mergerMode.sql](conf/evolutions/045-annotationsettings-mergerMode.sql)

## [19.09.0](https://github.com/scalableminds/webknossos/releases/tag/19.09.0) - 2019-08-28
No migrations necessary.

## [19.08.0](https://github.com/scalableminds/webknossos/releases/tag/19.08.0) - 2019-07-29
No migrations necessary.


## [19.07.0](https://github.com/scalableminds/webknossos/releases/tag/19.07.0) - 2019-07-01
### Postgres Evolutions:
- [043-annotationsettings-allowedMagnifications.sql](conf/evolutions/043-annotationsettings-allowedMagnifications.sql)
- [044-datasource-hash.sql](conf/evolutions/044-datasource-hash.sql)


## [19.06.0](https://github.com/scalableminds/webknossos/releases/tag/19.06.0) - 2019-05-27
No migrations necessary.


## [19.05.0](https://github.com/scalableminds/webknossos/releases/tag/19.05.0) - 2019-04-29
### Postgres Evolutions:
- [042-add-json-object-constraints.sql](conf/evolutions/042-add-json-object-constraints.sql)


## [19.04.0](https://github.com/scalableminds/webknossos/releases/tag/19.04.0) - 2019-04-01
- Redis is now needed for the tracingstore module. Make sure to install redis in your setup and adapt the config keys `tracingstore.redis.address` and `tracingstore.redis.port`.
- To ensure that the existing behavior for loading data is preserved ("best quality first" as opposed to the new "progressive quality" default) execute: `update webknossos.user_datasetconfigurations set configuration = configuration || jsonb '{"loadingStrategy":"BEST_QUALITY_FIRST"}'`. See [#3801](https://github.com/scalableminds/webknossos/pull/3801) for additional context.
- The config parameter `application.title` has been added. Make sure to set a title for your instance.
- The assets URLs now include `assets/` again, if you link to assets directly, please update the paths (e.g. in postgres `organizations.logoUrl`)

### Postgres Evolutions:
- [041-add-datastore-isconnector.sql](conf/evolutions/041-add-datastore-isconnector.sql)


## [19.03.0](https://github.com/scalableminds/webknossos/releases/tag/19.03.0) - 2019-03-04
- The config paramters `application.authentication.enableDevAutoVerify` and `application.authentication.enableDevAutoAdmin` have been removed. To enable automatic verification for user signup, set the organization’s new `enableAutoVerify` field to `true` in the database.

### Postgres Evolutions:
- [038-more-voxel-types.sql](conf/evolutions/038-more-voxel-types.sql)
- [039-add-tasktype-tracingtype.sql](conf/evolutions/039-add-tasktype-tracingtype.sql)
- [040-add-auto-activate-per-orga.sql](conf/evolutions/040-add-auto-activate-per-orga.sql)


## [19.02.0](https://github.com/scalableminds/webknossos/releases/tag/19.02.0) - 2019-02-04
- WebKnossos has a publication gallery now. There is no public interface to create publications yet, but instead those need to be inserted into the database directly.
  Publications and additional dataset properties that are displayed in the gallery as well, can be inserted as follows:
  ```
  insert into webknossos.publications(_id, publicationDate, imageUrl, title, description) values('5c3c9ec895010095014759fd', NOW(), '<LINK_TO_IMAGE>', '<TITLE>', '<DESCRIPTION>');

  update webknossos.datasets set _publication = '5c3c9ec895010095014759fd', details='{"species":"<e.g. Mouse>", "brain-region":"<e.g. cortex>", "acquisition":"<e.g. Raw CLSM data>"}' where _id = '<DATASET_ID>' ;
  ```

### Postgres Evolutions:
- [037-add-publications.sql](conf/evolutions/037-add-publications.sql)


## [19.01.0](https://github.com/scalableminds/webknossos/releases/tag/19.01.0) - 2019-01-14
### Postgres Evolutions:
- [036-add-lastTaskTypeId-to-user.sql](conf/evolutions/036-add-lastTaskTypeId-to-user.sql)


## [18.12.0](https://github.com/scalableminds/webknossos/releases/tag/18.12.0) - 2018-11-26
- If additional dataset directories were watched using the config key `additionalFolders`, those symlinks are no longer updated. Consider setting up additional datastores for these directories respectively.

### Postgres Evolutions:
- [033-tasktype-recommendedConfiguration.sql](conf/evolutions/033-tasktype-recommendedConfiguration.sql)
- [034-meshes.sql](conf/evolutions/034-meshes.sql)
- [035-add-annotation-dataset-foreign-key.sql](conf/evolutions/035-add-annotation-dataset-foreign-key.sql)


## [18.11.0](https://github.com/scalableminds/webknossos/releases/tag/18.11.0) - 2018-10-29
- Some config keys have changed, if you overwrite them in your setup, please adapt: the `oxalis` prefix is renamed to `webKnossos` so the new keys are `webKnossos.user.time.tracingPauseInSeconds`, `webKnossos.tasks.maxOpenPerUser`, `webKnossos.newOrganizationMailingList` as well as `datastore.webKnossos.uri`, `datastore.webKnossos.secured`, `datastore.webKnossos.pingIntervalMinutes` for the data store.
- There is now a separate module for the tracingstore, the datastore is no longer responsible for saving tracings. This module can run as a standalone application, or as a module of webKnossos locally. It is recommended that you choose the option that was previously also in place for datastores. In case of a standalone datastore, the local one needs to be disabled in application.conf: `tracingstore.enabled = false` and `play.modules.disabled += "com.scalableminds.braingames.datastore.TracingStoreModule` – and in either case, the adress of the tracingstore (localhost or remote) needs to be inserted in the db in `webknossos.tracingStores`.
- The FossilDB version has changed from `0.1.10` to `0.1.14`.
- The FossilDB needs to be run with an additional column family `volumeUpdates`.
- If your setup overwrites the config key `play.http.router` to disable the local datastore, change it to `"noDS.Routes"` (or `"noDS.noTS.Routes"` to also disable the local tracingstore).

#### Postgres Evolutions:
- [027-drop-dataset-name-unique-constraint.sql](conf/evolutions/027-drop-dataset-name-unique-constraint.sql)
- [028-add-isBlacklistedFromReport.sql](conf/evolutions/028-add-isBlacklistedFromReport.sql)
- [029-foreign-keys-deferrable.sql](conf/evolutions/029-foreign-keys-deferrable.sql)
- [030-tracingstore.sql](conf/evolutions/030-tracingstore.sql)
- [031-maintenance.sql](conf/evolutions/031-maintenance.sql)
- [032-scratch-datastores.sql](conf/evolutions/032-scratch-datastores.sql)


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
