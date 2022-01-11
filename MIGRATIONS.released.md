# Migration Guide (Released)
All migrations of webKnossos are documented in this file.
See `MIGRATIONS.unreleased.md` for the changes which are not yet part of an official release.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## [22.01.0](https://github.com/scalableminds/webknossos/releases/tag/22.01.0) - 2022-01-04
[Commits](https://github.com/scalableminds/webknossos/compare/21.11.0...22.01.0)
- The datastore now also needs access to a Redis database. New config fields `datastore.redis.address` and `datastore.redis.port` are required. Note that this Redis instance may be the same one the tracingstore uses, but does not have to be.

### Postgres Evolutions:
- [078-annotation-layers.sql](conf/evolutions/078-annotation-layers.sql)
- [079-add-dataset-tags.sql](conf/evolutions/079-add-dataset-tags.sql)


## [21.11.0](https://github.com/scalableminds/webknossos/releases/tag/21.11.0) - 2021-11-30
- The docker files now place the webKnossos installation under `/webknossos` instead of `/srv/webknossos`. All mounts, most importantly `/srv/webknossos/binaryData`, need to be changed accordingly.
- The entrypoint of the docker files have changed. Therefore, any existing `docker-compose.yml` setups need to be adapted. In most cases, only the `entrypoint: bin/webknossos` lines need to be removed (if existant).
- To receive Slack notifications about slow bucket requests, overwrite `slackNotifications.uri` in the webknossos-datastore config.
- If your setup includes a webknossos-worker, it needs to be updated to the latest version (PR https://github.com/scalableminds/webknossos-worker/pull/70)

### Postgres Evolutions:
- [077-workers.sql](conf/evolutions/077-workers.sql)

## [21.10.0](https://github.com/scalableminds/webknossos/releases/tag/21.10.0) - 2021-11-08

### Postgres Evolutions:
- [076-jobs-enabled-per-datastore.sql](conf/evolutions/076-jobs-enabled-per-datastore.sql)

## [21.09.0](https://github.com/scalableminds/webknossos/releases/tag/21.09.0) - 2021-10-01
- For webknossos.org: Change `publicDemoDatasetUrl` in the `features`-block within `application.conf` to be an actionable URL. For example, append `/createExplorative/hybrid?fallbackLayerName=segmentation` to the URL so that a new annotation is created if a user clicks on `Open a Demo Dataset` in the dashboard.

### Postgres Evolutions:
- [075-tasktype-remove-hovered-cell-id.sql](conf/evolutions/075-tasktype-remove-hovered-cell-id.sql)

## [21.08.0](https://github.com/scalableminds/webknossos/releases/tag/21.08.0) - 2021-08-26
[Commits](https://github.com/scalableminds/webknossos/compare/21.07.0...21.08.0)
No migrations necessary.

## [21.07.0](https://github.com/scalableminds/webknossos/releases/tag/21.07.0) - 2021-07-21

- Consider setting `defaultToLegacyBindings` to `true` in application.conf if you want that new users use the classic controls by default.
- To make the classic mouse bindings the default for existing users and task types execute the following (adapt `true` to `false` if you want the opposite):
```
-- Activate legacy bindings for all users
UPDATE webknossos.users
SET userconfiguration = jsonb_set(
        userconfiguration,
        array['useLegacyBindings'],
        to_jsonb('true'::boolean))

-- Recommend legacy bindings for users when starting a new task
UPDATE webknossos.tasktypes
SET recommendedconfiguration = jsonb_set(
        recommendedconfiguration,
        array['useLegacyBindings'],
        to_jsonb('true'::boolean))
```
- The health check at api/health does not longer include checking data/health and tracings/health if the respective local modules are enabled. Consider monitoring those routes separately.
- Run as sql: `UPDATE webknossos.tasktypes SET recommendedconfiguration = recommendedconfiguration - 'highlightHoveredCellId';` to avoid invalid recommended configurations in existing task types. This was added later as evolution 75, but should be run already here (note that it is idempotent).

### Postgres Evolutions:
- [072-jobs-manually-repaired.sql](conf/evolutions/072-jobs-manually-repaired.sql)
- [073-modern-controls-user-conf.sql](conf/evolutions/073-modern-controls-user-conf.sql)
- [074-jobs-owner-foreign-key.sql](conf/evolutions/074-jobs-owner-foreign-key.sql)


## [21.06.0](https://github.com/scalableminds/webknossos/releases/tag/21.06.0) - 2021-06-01

### Postgres Evolutions:
- [071-adapt-td-view-display-planes.sql](conf/evolutions/071-adapt-td-view-display-planes.sql)


## [21.05.1](https://github.com/scalableminds/webknossos/releases/tag/21.05.1) - 2021-05-05
- The config keys in application.conf were restructured. If you overwrite any of them for your config, please adapt to the new structure, according to the table below. If you run any stand-alone datastores or tracingstores, make sure to update their config files as well.

old key | new key | notes
--------|--------|-------
`http.address` | removed | used by play, default is 0.0.0.0, you can still overwrite it if necessary
`actor.defaultTimeout` | removed | was already unused
`js.defaultTimeout` | removed | was already unused
`akka.loggers` | removed | was already unused
`application.name` | removed | was already unused
`application.branch` | removed | was already unused
`application.version` | removed | was already unused
`application.title` | `webKnossos.tabTitle` |
`application.insertInitialData` | `webKnossos.sampleOrganization.enabled` |
`application.insertLocalConnectDatastore` | removed | feature removed, insert manually instead
`application.authentication.defaultuser.email` | `webKnossos.sampleOrganization.user.email` |
`application.authentication.defaultUser.password` | `webKnossos.sampleOrganization.user.password` |
`application.authentication.defaultUser.token` | `webKnossos.sampleOrganization.user.token` |
`application.authentication.defaultUser.isSuperUser` | `webKnossos.sampleOrganization.user.isSuperUser` |
`application.authentication.ssoKey` | `webKnossos.user.ssoKey` |
`application.authentication.inviteExpiry` | `webKnossos.user.inviteExpiry` |
`webKnossos.user.time.tracingPauseInSeconds` | `webKnossos.user.time.tracingPause` | **type changed from Int to FiniteDuration, add ` seconds`**
`webKnossos.query.maxResults` | removed | was already unused
`user.cacheTimeoutInMinutes` | `webKnossos.cache.user.timeout` | **type changed from Int to FiniteDuration, add ` minutes`**
`tracingstore.enabled` | removed | info contained in `play.modules.enabled`
`datastore.enabled` | removed | info contained in `play.modules.enabled`
`datastore.webKnossos.pingIntervalMinutes` | `datastore.webKnossos.pingInterval` | **type changed from Int to FiniteDuration, add ` minutes`**
`braingames.binary.cacheMaxSize` | `datastore.cache.dataCube.maxEntries` |
`braingames.binary.mappingCacheMaxSize` | `datastore.cache.mapping.maxEntries` |
`braingames.binary.agglomerateFileCacheMaxSize` | `datastore.cache.agglomerateFile.maxFileHandleEntries` |
`braingames.binary.agglomerateCacheMaxSize` | `datastore.cache.agglomerateFile.maxSegmentIdEntries` |
`braingames.binary.agglomerateStandardBlockSize` | `datastore.cache.agglomerateFile.blockSize` |
`braingames.binary.agglomerateMaxReaderRange` | `datastore.cache.agglomerateFile.cumsumMaxReaderRange` |
`braingames.binary.loadTimeout` | removed | was already unused
`braingames.binary.saveTimeout` | removed | was already unused
`braingames.binary.isosurfaceTimeout` | `datastore.isosurface.timeout` |  **type changed from Int to FiniteDuration, add ` seconds`**
`braingames.binary.isosurfaceActorPoolSize` | `datastore.isosurface.actorPoolSize` |
`braingames.binary.baseFolder` | `datastore.baseFolder`
`braingames.binary.agglomerateSkeletonEdgeLimit` | `datastore.agglomerateSkeleton.maxEdges`
`braingames.binary.changeHandler.enabled` | `datastore.watchFileSystem.enabled`
`braingames.binary.tickerInterval` | `datastore.watchFileSystem.interval` |  **type changed from Int to FiniteDuration, add ` minutes`**
`mail.enabled` | removed | now enabled if `mail.host` is non-empty
`jobs.username` | `jobs.user` |
`braintracing.active` | `braintracing.enabled`
`braintracing.url` | `braintracing.uri`
`airbrake.apiKey` | removed | was already unused
`airbrake.ssl` | removed | was already unused
`airbrake.enabled` | removed | was already unused
`airbrake.endpoint` | removed | was already unused
`slackNotifications.url` | `slackNotifications.uri` |
`google.analytics.trackingId` | `googleAnalytics.trackingId` |
`operatorData` | `webKnossos.operatorData`

### Postgres Evolutions:
- [070-dark-theme.sql](conf/evolutions/070-dark-theme.sql)


## [21.05.0](https://github.com/scalableminds/webknossos/releases/tag/21.05.0) - 2021-04-22
- Instances with long-running jobs only: the `tiff_cubing` job was renamed to `convert_to_wkw`. For old jobs to be listed properly, execute sql `update webknossos.jobs set command = 'convert_to_wkw' where command = 'tiff_cubing';`

### Postgres Evolutions:
- [068-pricing-plan.sql](conf/evolutions/068-pricing-plan.sql)
- [069-tasktype-project-unique-per-orga.sql](conf/evolutions/069-tasktype-project-unique-per-orga.sql)

## [21.04.0](https://github.com/scalableminds/webknossos/releases/tag/21.04.0) - 2021-03-22

### Postgres Evolutions:
- [066-publications-foreign-key.sql](conf/evolutions/066-publications-foreign-key.sql)
- [067-drop-analytics.sql](conf/evolutions/067-drop-analytics.sql)

## [21.03.0](https://github.com/scalableminds/webknossos/releases/tag/21.03.0) - 2021-02-24
- Support for KNOSSOS cubes data format was removed. Use the [webKnossos cuber](https://github.com/scalableminds/webknossos-cuber) tool to convert existing datasets saved as KNOSSOS cubes.
- Multi-organization instances only: user experience domains are now separated per organization. After postgres evolution 64 (see below), make sure to move existing experience domains to the correct organization in the database. (The evolution just selects any one from the database).

### Postgres Evolutions:
- [061-userinfos-view.sql](conf/evolutions/061-userinfos-view.sql)
- [062-dataset-uploader.sql](conf/evolutions/062-dataset-uploader.sql)
- [063-novelUserExperienceinfos.sql](conf/evolutions/063-novelUserExperienceinfos.sql)
- [064-experienceDomains-per-orga.sql](conf/evolutions/064-experienceDomains-per-orga.sql)
- [065-unlisted-superusers.sql](conf/evolutions/065-unlisted-superusers.sql)

## [21.02.1](https://github.com/scalableminds/webknossos/releases/tag/21.02.1) - 2021-02-03
[Commits](https://github.com/scalableminds/webknossos/compare/21.02.0...21.02.1)
No migrations necessary.

## [21.02.0](https://github.com/scalableminds/webknossos/releases/tag/21.02.0) - 2021-01-20
- [060-multiusers.sql](conf/evolutions/060-multiusers.sql) (Note that its reversion can only be performed if there are no multiple users per multiuser yet)

## [21.01.0](https://github.com/scalableminds/webknossos/releases/tag/21.01.0) - 2020-12-21
No migrations necessary.

## [20.12.0](https://github.com/scalableminds/webknossos/releases/tag/20.12.0) - 2020-11-23
- As volume annotations in arbitrary magnifications are now supported and the behavior of magnification restrictions of tasks has changed (allow full zoom, but disable tools unless in correct magnification), you may want to restrict all volume and hybrid task types to mag 1 to achieve the old behavior (mag1-only). NOTE: This query has to be executed BEFORE evolution 59 is performed.
```
update webknossos.tasktypes
set settings_allowedmagnifications = '{"min":1,"max":1,"shouldRestrict":true}'
where (tracingtype = 'volume' or tracingtype = 'hybrid')
and (settings_allowedmagnifications is null or settings_allowedmagnifications::json->>'shouldRestrict'='false');
```

### Postgres Evolutions:
- [057-add-layer-specific-view-configs.sql](conf/evolutions/057-add-layer-specific-view-configs.sql)
- [058-add-onlyAllowedOrganization.sql](conf/evolutions/058-add-onlyAllowedOrganization.sql)
- [059-resolution-restrictions.sql](conf/evolutions/059-resolution-restrictions.sql)


## [20.11.0](https://github.com/scalableminds/webknossos/releases/tag/20.11.0) - 2020-10-26
- [056-add-jobs.sql](conf/evolutions/056-add-jobs.sql)

## [20.10.0](https://github.com/scalableminds/webknossos/releases/tag/20.10.0) - 2020-09-21
No migrations necessary.

## [20.09.0](https://github.com/scalableminds/webknossos/releases/tag/20.09.0) - 2020-08-20
No migrations necessary.

## [20.08.0](https://github.com/scalableminds/webknossos/releases/tag/20.08.0) - 2020-07-20
### Postgres Evolutions:
- [054-add-isDatasetManager.sql](conf/evolutions/054-add-isDatasetManager.sql)
- [055-make-organization-name-unique.sql](conf/evolutions/055-make-organization-name-unique.sql)

## [20.07.0](https://github.com/scalableminds/webknossos/releases/tag/20.07.0) - 2020-06-29
No migrations necessary.

## [20.06.0](https://github.com/scalableminds/webknossos/releases/tag/20.06.0) - 2020-05-25
### Postgres Evolutions:
- [053-add-allowsUpload.sql](conf/evolutions/053-add-allowsUpload.sql)

## [20.05.0](https://github.com/scalableminds/webknossos/releases/tag/20.05.0) - 2020-05-05
- The optional `defaultOrganization` attribute from the `features` block in `application.conf` is not used anymore and can be removed. [#4559](https://github.com/scalableminds/webknossos/pull/4559)

## [20.04.0](https://github.com/scalableminds/webknossos/releases/tag/20.04.0) - 2020-03-23
- Default interval for detecting new/deleted datasets on disk (`braingames.binary.changeHandler.tickerInterval` in the config) has been reduced from 10 to 1 minute. If you relied on the value being 10 minutes, you have to set it explicitly now.

### Postgres Evolutions:
- [051-add-source-view-configuration.sql](conf/evolutions/051-add-source-view-configuration.sql)
- [052-replace-segmentation-opacity.sql](conf/evolutions/052-replace-segmentation-opacity.sql)

## [20.03.0](https://github.com/scalableminds/webknossos/releases/tag/20.03.0) - 2020-02-27
No migrations necessary.

## [20.2.0](https://github.com/scalableminds/webknossos/releases/tag/20.2.0) - 2020-01-27
### Postgres Evolutions:
- [050-add-annotation-visibility-enum.sql](conf/evolutions/050-add-annotation-visibility-enum.sql)

## [20.1.0](https://github.com/scalableminds/webknossos/releases/tag/20.1.0) - 2020-01-08
- The initial organization was renamed to `sample_organization`. Make sure to move the data over or to put a symlink in place.
- The default `operatorData` was replaced. Make sure to update with valid information for public deployments.
- The config `uri` has been refactored. Pairs of `uri` and `secured` have been replaced with just `uri` which now requires a `http://` or `https://` prefix.

### Postgres Evolutions:
- [049-annotation-listed-teams.sql](conf/evolutions/049-annotation-listed-teams.sql)


## [19.12.0](https://github.com/scalableminds/webknossos/releases/tag/19.12.0) - 2019-11-25
No migrations necessary.

## [19.11.0](https://github.com/scalableminds/webknossos/releases/tag/19.11.0) - 2019-10-28
### Postgres Evolutions:
- [046-fix-missing-voxel-type.sql](conf/evolutions/046-fix-missing-voxel-type.sql)
- [047-add-datastore-publicUrl.sql](conf/evolutions/047-add-datastore-publicUrl.sql)
- [048-add-tracingstore-publicUrl.sql](conf/evolutions/048-add-tracingstore-publicUrl.sql)

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