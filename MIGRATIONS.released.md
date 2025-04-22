# Migration Guide (Released)

All migrations of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.unreleased.md` for the changes which are not yet part of an official release.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## [25.04.1](https://github.com/scalableminds/webknossos/releases/tag/25.04.1) - 2025-04-22
[Commits](https://github.com/scalableminds/webknossos/compare/25.03.1...25.04.1)
- New FossilDB version `0.1.37` (`master__525:` on dockerhub) is required. [#8460](https://github.com/scalableminds/webknossos/pull/8460)
- NodeJs version `22+` is required. [#8479](https://github.com/scalableminds/webknossos/pull/8479)

### Postgres Evolutions:
None.

## [25.03.1](https://github.com/scalableminds/webknossos/releases/tag/25.03.1) - 2025-04-10
[Commits](https://github.com/scalableminds/webknossos/compare/25.03.0...25.03.1)

### Postgres Evolutions:
None.

## [25.03.0](https://github.com/scalableminds/webknossos/releases/tag/25.03.0) - 2025-04-01
[Commits](https://github.com/scalableminds/webknossos/compare/25.02.1...25.03.0)

- FossilDB now needs to be opened with additional column family `skeletonTreeBodies`. [#8423](https://github.com/scalableminds/webknossos/pull/8423)

### Postgres Evolutions:
- [126-mag-real-paths.sql](conf/evolutions/126-mag-real-paths.sql)
- [127-job-retried-by-super-user.sql](conf/evolutions/127-job-retried-by-super-user.sql)
- [128-allow-ai-model-sharing.sql](conf/evolutions/128-allow-ai-model-sharing.sql)
- [129-credit-transactions.sql](conf/evolutions/129-credit-transactions.sql)
- [130-replace-text-types.sql](conf/evolutions/130-replace-text-types.sql)

## [25.02.1](https://github.com/scalableminds/webknossos/releases/tag/25.02.1) - 2025-02-26
[Commits](https://github.com/scalableminds/webknossos/compare/25.02.0...25.02.1)

### Postgres Evolutions:
None.

## [25.02.0](https://github.com/scalableminds/webknossos/releases/tag/25.02.0) - 2025-02-17
[Commits](https://github.com/scalableminds/webknossos/compare/25.01.0...25.02.0)
- config options `proxy.prefix` and `proxy.routes` were renamed to `aboutPageRedirect.prefix` and `aboutPageRedirect.routes` (as we no longer proxy, but redirect). [#8344](https://github.com/scalableminds/webknossos/pull/8344)
- The migration route `addSegmentIndex` was removed. If you haven’t done this yet, but need segment indices for your volume annotations, upgrade to an earlier version first, call addSegmentIndex, and then upgrade again. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
- The versioning scheme of annotations has been changed. That requires a larger migration including the FossilDB content. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
     - The FossilDB content needs to be migrated. For that, use the python program at `tools/migration-unified-annotation-versioning` (see python main.py --help for instructions). Note that it writes to a completely new FossilDB, that must first be opened with the new column families, see below. The migration code needs to connect to postgres, to the old FossilDB and to the new. After the migration, replace the old FossilDB by the new one (either change the ports of the existing programs, or exchange the data directories on disk).
    - For the migration, a second FossilDB needs to be started. To do that, either use the docker image, a jar, or checkout the [fossilDB repository](https://github.com/scalableminds/fossildb). If you opened your old FossilDB with an options file, it probably makes sense to use the same options file for the new one as well.
    - New FossilDB version `0.1.34` (docker image `scalableminds/fossildb:master__510`) is required. Start both the source and target FossilDBs with this new version.
    - (Target) FossilDB must now be opened with new column family set `skeletons,volumes,volumeData,volumeSegmentIndex,editableMappingsInfo,editableMappingsAgglomerateToGraph,editableMappingsSegmentToAgglomerate,annotations,annotationUpdates`.
    - For large databases, the migration may take multiple hours or even days. To avoid long downtimes, the migration can also be run in several incremental steps so that the majority of the data can already be migrated while WEBKNOSSOS is still running. Then only annotations that have been edited again since the first run need to be migrated in the incremental second run during a WEBKNOSSOS downtime.
    - Example command for the migration: `PG_PASSWORD=myPassword python main.py --src localhost:7500 --dst localhost:7155 --num_threads 20 --postgres webknossos@localhost:5430/webknossos`

### Postgres Evolutions:
None.

## [25.01.0](https://github.com/scalableminds/webknossos/releases/tag/25.01.0) - 2025-01-22
[Commits](https://github.com/scalableminds/webknossos/compare/24.12.0...25.01.0)
- Removed support for HTTP API versions 3 and 4. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- New FossilDB version `0.1.33` (docker image `scalableminds/fossildb:master__504`) is required.
- Datastore config options `datastore.baseFolder` and `datastore.localFolderWhitelist` have been renamed to `datastore.baseDirectory` and `datastore.localDirectoryWhitelist` respectively, to avoid confusion with the dashboard folders. [#8292](https://github.com/scalableminds/webknossos/pull/8292)

### Postgres Evolutions:
- [124-decouple-dataset-directory-from-name.sql](conf/evolutions/124-decouple-dataset-directory-from-name.sql)
- [125-allow-dollar-in-layer-names.sql](conf/evolutions/125-allow-dollar-in-layer-names.sql)


## [24.12.0](https://github.com/scalableminds/webknossos/releases/tag/24.12.0) - 2024-12-05
[Commits](https://github.com/scalableminds/webknossos/compare/24.11.1...24.12.0)

- The config option `googleAnalytics.trackingId` is no longer used and can be removed. [#8201](https://github.com/scalableminds/webknossos/pull/8201)

## [24.11.1](https://github.com/scalableminds/webknossos/releases/tag/24.11.1) - 2024-11-13
[Commits](https://github.com/scalableminds/webknossos/compare/24.10.0...24.11.1)

### Postgres Evolutions:

- [121-worker-name.sql](conf/evolutions/121-worker-name.sql)
- [122-resolution-to-mag.sql](conf/evolutions/122-resolution-to-mag.sql)
- [123-more-model-categories.sql](conf/evolutions/123-more-model-categories.sql)


## [24.10.0](https://github.com/scalableminds/webknossos/releases/tag/24.10.0) - 2024-09-24
[Commits](https://github.com/scalableminds/webknossos/compare/24.08.1...24.10.0)

- For self-hosted versions of WEBKNOSSOS, you can choose whether switching to webknossos.org will be recommended to you, e.g. when uploading a dataset. To configure this, change `recommendWkorgInstance` in your `application.conf`.

### Postgres Evolutions:
None.

## [24.08.1](https://github.com/scalableminds/webknossos/releases/tag/24.08.1) - 2024-09-03
[Commits](https://github.com/scalableminds/webknossos/compare/24.08.0...24.08.1)

### Postgres Evolutions:
None.

## [24.08.0](https://github.com/scalableminds/webknossos/releases/tag/24.08.0) - 2024-09-02
[Commits](https://github.com/scalableminds/webknossos/compare/24.07.0...24.08.0)

- If Segment Anything was already configured, it needs to be pointed to an endpoint that works with SAM 2. [#7965](https://github.com/scalableminds/webknossos/pull/7965)

### Postgres Evolutions:
- [118-voxelytics-artifacts-index.sql](conf/evolutions/118-voxelytics-artifacts-index.sql)
- [119-add-metadata-to-folders-and-datasets.sql](conf/evolutions/119-add-metadata-to-folders-and-datasets.sql)
- [120-remove-old-organization-id.sql](conf/evolutions/120-remove-old-organization-id.sql)

## [24.07.0](https://github.com/scalableminds/webknossos/releases/tag/24.07.0) - 2024-07-05
[Commits](https://github.com/scalableminds/webknossos/compare/24.06.0...24.07.0)

- The datastore config field `datastore.cache.dataCube.maxEntries` is no longer used and can be removed. [#7818](https://github.com/scalableminds/webknossos/pull/7818)
- If your setup contains webknossos-workers, you may want to add the newly available job `align_sections` to the `supportedJobCommands` of your workers. Make sure you deploy the latest webknossos-worker release. [#7820](https://github.com/scalableminds/webknossos/pull/7820)
- If you place WKW datasets directly on disk, a datasource-properties.json is now required, as WEBKNOSSOS no longer guesses its contents from the raw data. Standard dataset creation methods, e.g. with the WEBKNOSSOS CLI or python libs will already automatically this metadata file. [#7697](https://github.com/scalableminds/webknossos/pull/7697)

### Postgres Evolutions:

- [114-ai-models.sql](conf/evolutions/114-ai-models.sql)
- [115-annotation-locked-by-user.sql](conf/evolutions/115-annotation-locked-by-user.sql)
- [116-drop-overtimemailinglist.sql](conf/evolutions/116-drop-overtimemailinglist.sql)
- [117-voxel-size-unit.sql](conf/evolutions/117-voxel-size-unit.sql)


## [24.06.0](https://github.com/scalableminds/webknossos/releases/tag/24.06.0) - 2024-05-27
[Commits](https://github.com/scalableminds/webknossos/compare/24.05.0...24.06.0)

### Postgres Evolutions:
None.

## [24.05.0](https://github.com/scalableminds/webknossos/releases/tag/24.05.0) - 2024-04-29
[Commits](https://github.com/scalableminds/webknossos/compare/24.04.0...24.05.0)

- Changed some internal APIs to use spelling dataset instead of dataSet. This requires all connected datastores to be the latest version. [#7690](https://github.com/scalableminds/webknossos/pull/7690)
- If your setup contains webknossos-workers, you may want to add the new available job `infer_mitochondria` to the `supportedJobCommands` of your workers. Make sure you deploy the latest webknossos-worker release. [#7752](https://github.com/scalableminds/webknossos/pull/7752)
- Meshfiles with version 2 or older are no longer supported. Talk to us about support in converting your old meshfiles. [#7764](https://github.com/scalableminds/webknossos/pull/7764)

### Postgres Evolutions:

- If your setup contains a worker, make sure to upgrade it to the latest version, as the authentication api has changed (user_auth_token rather than webknossos_token). [#6547](https://github.com/scalableminds/webknossos/pull/6547)


## [24.04.0](https://github.com/scalableminds/webknossos/releases/tag/24.04.0) - 2024-03-25
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.3...24.04.0)
- WKW datasets can now only be read if they have a `header.wkw` file in their mag directories. If specific datasets can no longer be loaded, consider adding such a file. Backend logging should show according error message. [#7528](https://github.com/scalableminds/webknossos/pull/7528)
- Content Security Policy (CSP) settings are now relaxed by default. To keep stricter CSP rules, add them to your specific `application.conf`. [#7589](https://github.com/scalableminds/webknossos/pull/7589)
- The way the segment index is stored for nd-annotations has been changed ([#7411](https://github.com/scalableminds/webknossos/pull/7411)). Annotations with old segment indices should be
archived if they do not contain relevant data. The following SQL query can be used:
```sql
UPDATE webknossos.annotations_ SET state = 'Finished' WHERE _id IN  (SELECT DISTINCT a._id AS nd_annotations_id FROM webknossos.annotations_ AS a INNER JOIN webknossos.datasets AS d ON a._dataset = d._id INNER JOIN webknossos.dataset_layer_additionalaxes AS dla ON d._id = dla._dataset)
```
- WEBKNOSSOS now uses Java 21 (up from Java 11). [#7599](https://github.com/scalableminds/webknossos/pull/7599)
- NodeJS version 18+ is required for snapshot tests with ShadowDOM elements from Antd v5. [#7522](https://github.com/scalableminds/webknossos/pull/7522)
- Email verification is disabled by default. To enable it, set `webKnossos.user.emailVerification.activated` to `true` in your `application.conf`. [#7620](https://github.com/scalableminds/webknossos/pull/7620) [#7621](https://github.com/scalableminds/webknossos/pull/7621)
- New dependency draco/libdraco-dev needs to be installed when deploying without docker and for local development.
- Config block `braintracing` is now unused and can be removed. [#7693](https://github.com/scalableminds/webknossos/pull/7693)

### Postgres Evolutions:

- [113-analytics-events.sql](conf/evolutions/113-analytics-events.sql)


## [24.02.3](https://github.com/scalableminds/webknossos/releases/tag/24.02.3) - 2024-02-22
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.2...24.02.3)

## [24.02.2](https://github.com/scalableminds/webknossos/releases/tag/24.02.2) - 2024-02-15
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.1...24.02.2)

## [24.02.1](https://github.com/scalableminds/webknossos/releases/tag/24.02.2) - 2024-02-15
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.0...24.02.1)

## [24.02.0](https://github.com/scalableminds/webknossos/releases/tag/24.02.0) - 2024-01-26
[Commits](https://github.com/scalableminds/webknossos/compare/23.12.0...24.02.0)
- The config `setting play.http.secret.key` (secret random string) now requires a minimum length of 32 bytes.
- If your setup contains webknossos-workers, postgres evolution 110 introduces the column `supportedJobCommands`. This needs to be filled in manually for your workers. Currently available job commands are `compute_mesh_file`, `compute_segment_index_file`, `convert_to_wkw`, `export_tiff`, `find_largest_segment_id`, `infer_nuclei`, `infer_neurons`, `materialize_volume_annotation`, `render_animation`. [#7463](https://github.com/scalableminds/webknossos/pull/7463)
- If your setup contains webknossos-workers,  postgres evolution 110 introduces the columns `maxParallelHighPriorityJobs` and `maxParallelLowPriorityJobs`. Make sure to set those values to match what you want for your deployment. [#7463](https://github.com/scalableminds/webknossos/pull/7463)
- If your setup contains webknossos-workers, you may want to add the new available worker job `compute_segment_index_file` to the `supportedJobCommands` column of one or more of your workers. [#7493](https://github.com/scalableminds/webknossos/pull/7493)
- The WEBKNOSSOS api version has changed to 6. The `isValidNewName` route for datasets now returns 200 regardless of whether the name is valid or not. The body contains a JSON object with the key "isValid". [#7550](https://github.com/scalableminds/webknossos/pull/7550)
- If your setup contains ND datasets, run the python3 script at `tools/migrate-axis-bounds/migration.py` on your datastores to update the datasource-properties.jsons of the ND datasets.
- With the upgrade to Play 3 and the migration to pekko, configuration keys using akka need to be changed. For the default configuration this results in the following changes:
  - akka.requestTimeout → pekko.requestTimeout
  - akka.actor.default-dispatcher → pekko.actor.default-dispatcher

### Postgres Evolutions:

- [110-worker-config.sql](conf/evolutions/110-worker-config.sql)
- [111-stats-per-annotation-layer.sql](conf/evolutions/111-stats-per-annotation-layer.sql)
- [112-reuse-deleted.sql](conf/evolutions/112-reuse-deleted.sql)


## [23.12.0](https://github.com/scalableminds/webknossos/releases/tag/23.12.0) - 2023-11-27
[Commits](https://github.com/scalableminds/webknossos/compare/23.11.0...23.12.0)

- If your deployment starts FossilDB separately, make sure to upgrade to version 0.1.27 (build master__484). Note that with the upgraded version, the database contents are automatically migrated. A downgrade to an older FossilDB version is not possible afterwards (creating an additional backup of the FossilDB data directory is advised)
- WEBKNOSSOS now sets the Content-Security-Policy (CSP) HTTP response header restricting which dynamic resources are allowed to load. Please update the `application.conf` - `play.filters.csp.directives` key if you'd like to change the default CSP. The default CSP is suited for WEBKNOSSOS development. For production follow the comments next to the respective directives in the `application.conf`, i.e. remove 'unsafe-inline' from the script-src, remove ws://localhost:9002 from the connect-src, add the URLs of all external datastores to the connect-src, and add the host domain to the connect-src. [#7367](https://github.com/scalableminds/webknossos/pull/7367) and [#7450](https://github.com/scalableminds/webknossos/pull/7450)

## [23.11.0](https://github.com/scalableminds/webknossos/releases/tag/23.11.0) - 2023-10-24
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.2...23.11.0)

- The `datastore/isosurface` configuration key was renamed to `datastore/adHocMesh.
- In order to enable segment statistics for existing volume annotations (without fallback segmentation), a user with superuser rights can call a migration route during a downtime. This will transform all volume annotation layers that qualify (cross organization). This will take some time, results will be logged by WEBKNOSSOS to stdout. The trigger route is `curl -X PATCH "<domain>/api/annotations/addSegmentIndicesToAll?parallelBatchCount=16" -H 'X-Auth-Token: <token>'` with the `parallelBatchCount` parameter controlling the parallelity of the migration (e.g. number of cpu cores of the tracingstore server). This action is designed to be idempotent.

## [23.10.2](https://github.com/scalableminds/webknossos/releases/tag/23.10.2) - 2023-09-26
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.1...23.10.2)

## [23.10.1](https://github.com/scalableminds/webknossos/releases/tag/23.10.1) - 2023-09-22
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.0...23.10.1)

## [23.10.0](https://github.com/scalableminds/webknossos/releases/tag/23.10.0) - 2023-09-21
[Commits](https://github.com/scalableminds/webknossos/compare/23.09.0...23.10.0)

### Postgres Evolutions:
- [108-additional-coordinates](conf/evolutions/108-additional-coordinates.sql)
- [109-scheduled-maintenances.sql](conf/evolutions/109-scheduled-maintenances.sql)


## [23.09.0](https://github.com/scalableminds/webknossos/releases/tag/23.09.0) - 2023-08-29
[Commits](https://github.com/scalableminds/webknossos/compare/23.08.0...23.09.0)

- Postgres Evolution 105 (see below) adds email verification and sets the emails of all existing users as verified.
To set all email addresses as unverified, execute this query:
```sql
UPDATE webknossos.multiUsers SET isEmailVerified = false;
```

- When interacting with webknossos via the python library, make sure you update to the latest version, as the task and project api have changed. Compare [webknossos-libs#930](https://github.com/scalableminds/webknossos-libs/pull/930). [#7220](https://github.com/scalableminds/webknossos/pull/7220)

 - If you have OIDC authentication set up, you can now remove the config keys `singleSignOn.openIdConnect.publicKey` and `singleSignOn.openIdConnect.publicKeyAlgorithm`, as the server’s public key is now automatically fetched. [#7267](https://github.com/scalableminds/webknossos/pull/7267)

### Postgres Evolutions:
- [105-verify-email.sql](conf/evolutions/105-verify-email.sql)
- [106-folder-no-slashes.sql](conf/evolutions/106-folder-no-slashes.sql)
- [107-task-terminology.sql](conf/evolutions/107-task-terminology.sql)


## [23.08.0](https://github.com/scalableminds/webknossos/releases/tag/23.08.0) - 2023-07-24
[Commits](https://github.com/scalableminds/webknossos/compare/23.07.0...23.08.0)

### Postgres Evolutions:
- [103-thin-plane-splines.sql](conf/evolutions/103-thin-plane-splines.sql)
- [104-thumbnails.sql](conf/evolutions/104-thumbnails.sql)


## [23.07.0](https://github.com/scalableminds/webknossos/releases/tag/23.07.0) - 2023-06-20
[Commits](https://github.com/scalableminds/webknossos/compare/23.06.0...23.07.0)
- FossilDB needs to be opened with new additional column family volumeSegmentIndex.

### Postgres Evolutions:
- [102-no-more-wkconnect.sql](conf/evolutions/102-no-more-wkconnect.sql)

## [23.06.0](https://github.com/scalableminds/webknossos/releases/tag/23.06.0) - 2023-05-30
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.2...23.06.0)
- FossilDB needs to be opened with new additional column families editableMappingsInfo, editableMappingsAgglomerateToGraph, editableMappingsSegmentToAgglomerate.
- For instances with existing editable mapping (a.k.a supervoxel proofreading) annotations: To keep those annotations alive, a python migration has to be run with access to your tracingstore’s FossilDB. It is recommended to do this during a webknossos downtime to avoid data loss. It needs python 3.8+ and the pip packages installable by `pip install grpcio-tools grpcio-health-checking`. Run it with `python tools/migrate-editable-mappings/migrate-editable-mappings.py -v -w -o localhost:7155`. Omit -o for a faster migration but no access to older versions of the editable mappings. The migration is idempotent.
- The datastore now needs `brotli`. For Debian-based systems, this can be installed with `apt-get install libbrotli1`.
- New FossilDB version 0.1.23 (`master__448` on Dockerhub) is required, compare [FossilDB PR](https://github.com/scalableminds/fossildb/pull/38).

### Postgres Evolutions:
None.

## [23.05.2](https://github.com/scalableminds/webknossos/releases/tag/23.05.2) - 2023-05-08
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.1...23.05.2)

### Postgres Evolutions:
None.

## [23.05.1](https://github.com/scalableminds/webknossos/releases/tag/23.05.1) - 2023-05-02
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.0...23.05.1)

### Postgres Evolutions:
None.

## [23.05.0](https://github.com/scalableminds/webknossos/releases/tag/23.05.0) - 2023-04-25
[Commits](https://github.com/scalableminds/webknossos/compare/23.04.2...23.05.0)
- The config key features.isDemoInstance was renamed to features.isWkorgInstance (only needs to be adapted for the main wkorg instance). [#6941](https://github.com/scalableminds/webknossos/pull/6941/files)

### Postgres Evolutions:
None.

## [23.04.2](https://github.com/scalableminds/webknossos/releases/tag/23.04.2) - 2023-04-14
[Commits](https://github.com/scalableminds/webknossos/compare/23.04.1...23.04.2)

### Postgres Evolutions:
None.

## [23.04.1](https://github.com/scalableminds/webknossos/releases/tag/23.04.1) - 2023-04-06
[Commits](https://github.com/scalableminds/webknossos/compare/23.04.0...23.04.1)

### Postgres Evolutions:
None.

## [23.04.0](https://github.com/scalableminds/webknossos/releases/tag/23.04.0) - 2023-03-27
[Commits](https://github.com/scalableminds/webknossos/compare/23.03.1...23.04.0)

### Postgres Evolutions:
- [101-coordinate-transformations.sql](conf/evolutions/101-coordinate-transformations.sql)

## [23.03.1](https://github.com/scalableminds/webknossos/releases/tag/23.03.1) - 2023-03-14
[Commits](https://github.com/scalableminds/webknossos/compare/23.03.0...23.03.1)
- WEBKNOSSOS now requires at least Java 11 (up from Java 8). [#6869](https://github.com/scalableminds/webknossos/pull/6869)

### Postgres Evolutions:
None.

## [23.03.0](https://github.com/scalableminds/webknossos/releases/tag/23.03.0) - 2023-02-28
[Commits](https://github.com/scalableminds/webknossos/compare/23.02.1...23.03.0)

- WEBKNOSSOS now requires Node.js not only for development and building, but also for execution. The prebuilt Docker images already contain this dependency. If you're using these, nothing needs to be changed. [#6803](https://github.com/scalableminds/webknossos/pull/6803)
- Requires Voxelytics worker version 23.02.xx for long-running jobs. [#6838](https://github.com/scalableminds/webknossos/pull/6838)

### Postgres Evolutions:

- [099-rename-credential-types.sql](conf/evolutions/099-rename-credential-types.sql)
- [100-annotation-mutexes.sql](conf/evolutions/100-annotation-mutexes.sql)


## [23.02.1](https://github.com/scalableminds/webknossos/releases/tag/23.02.1) - 2023-02-07
[Commits](https://github.com/scalableminds/webknossos/compare/23.02.0...23.02.1)

### Postgres Evolutions:
None.

## [23.02.0](https://github.com/scalableminds/webknossos/releases/tag/23.02.0) - 2023-02-01
[Commits](https://github.com/scalableminds/webknossos/compare/23.01.0...23.02.0)

- WEBKNOSSOS requires Loki instead of Elasticsearch for Voxelytics logging now. Please update the `application.conf`: Remove `voxelytics.elasticsearch.index`, rename `voxelytics.elasticsearch` to `voxelytics.loki`, and update `voxelytics.loki.uri`. [#6770](https://github.com/scalableminds/webknossos/pull/6770)

### Postgres Evolutions:

- [094-pricing-plans.sql](conf/evolutions/094-pricing-plans.sql)
- [095-constraint-naming.sql](conf/evolutions/095-constraint-naming.sql)
- [096-storage.sql](conf/evolutions/096-storage.sql)
- [097-credentials.sql](conf/evolutions/097-credentials.sql)
- [098-voxelytics-states.sql](conf/evolutions/098-voxelytics-states.sql)


## [23.01.0](https://github.com/scalableminds/webknossos/releases/tag/23.01.0) - 2023-01-03
[Commits](https://github.com/scalableminds/webknossos/compare/22.12.0...23.01.0)

- Bulk task creation now needs the taskTypeId, the task type summary will no longer be accepted. If you have scripts generating CSVs for bulk task creation, they should not output task type summaries. [#6640](https://github.com/scalableminds/webknossos/pull/6640)

### Postgres Evolutions:

- [091-folders.sql](conf/evolutions/091-folders.sql)
- [092-oidc.sql](conf/evolutions/092-oidc.sql)
- [093-terms-of-service.sql](conf/evolutions/093-terms-of-service.sql)


## [22.12.0](https://github.com/scalableminds/webknossos/releases/tag/22.12.0) - 2022-11-24
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.2...22.12.0)

### Postgres Evolutions:
None.


## [22.11.2](https://github.com/scalableminds/webknossos/releases/tag/22.11.2) - 2022-11-10
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.1...22.11.2)

### Postgres Evolutions:
None.


## [22.11.1](https://github.com/scalableminds/webknossos/releases/tag/22.11.1) - 2022-10-27
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.0...22.11.1)

### Postgres Evolutions:
None.


## [22.11.0](https://github.com/scalableminds/webknossos/releases/tag/22.11.0) - 2022-10-24
[Commits](https://github.com/scalableminds/webknossos/compare/22.10.0...22.11.0)

### Postgres Evolutions:
None.

## [22.10.0](https://github.com/scalableminds/webknossos/releases/tag/22.10.0) - 2022-09-27
[Commits](https://github.com/scalableminds/webknossos/compare/22.09.0...22.10.0)

- To use the Voxelytics reporting features in webKnossos, the config field `features.voxelyticsEnabled` needs to be set to true. When also using the logging features, an Elasticsearch instance needs to be running and configured in the config field `voxelytics.elasticsearch.uri`.

### Postgres Evolutions:
- [088-shortlinks.sql](conf/evolutions/088-shortlinks.sql)
- [089-voxelytics.sql](conf/evolutions/089-voxelytics.sql)
- [090-cleanup.sql](conf/evolutions/090-cleanup.sql)


## [22.09.0](https://github.com/scalableminds/webknossos/releases/tag/22.09.0) - 2022-08-25
[Commits](https://github.com/scalableminds/webknossos/compare/22.08.0...22.09.0)

- webKnossos requires node 16 now. [#6350](https://github.com/scalableminds/webknossos/pull/6350)
- Removed the foreign datastore feature. If you have any foreign datastores registered in your webKnossos, running this upgrade may result in undefined behavior. [#6392](https://github.com/scalableminds/webknossos/pull/6392)

### Postgres Evolutions:
- [084-annotation-contributors.sql](conf/evolutions/084-annotation-contributors.sql)
- [085-annotation-publication.sql](conf/evolutions/085-annotation-publication.sql)
- [086-drop-foreign-datastores.sql](conf/evolutions/086-drop-foreign-datastores.sql)
- [087-zarr-private-links.sql](conf/evolutions/087-zarr-private-links.sql)


## [22.08.0](https://github.com/scalableminds/webknossos/releases/tag/22.08.0) - 2022-07-20
[Commits](https://github.com/scalableminds/webknossos/compare/22.07.0...22.08.0)

 - Postgres evolution 83 (see below) introduces unique and url-safe constraints for annotation layer names. If the database contains entries violating those new constraints, they need to be fixed manually, otherwise the evolution will abort:
    - change null names to the front-end-side defaults:
        ```
        update webknossos.annotation_layers set name = 'Volume' where name is null and typ = 'Volume'
        update webknossos.annotation_layers set name = 'Skeleton' where name is null and typ = 'Skeleton'
        ```

    - find annotations with multiple layers, make unique manually
        ```
        select _annotation, name from webknossos.annotation_layers where _annotation in (select s._annotation from
        (select _annotation, count(_annotation) from webknossos.annotation_layers where typ = 'Volume' group by _annotation order by count(_annotation) desc limit 1000) as s
        where count > 1) and typ = 'Volume' order by _annotation
        ```

   - find layers with interesting names, manually remove spaces and special characters
        ```
        select * from webknossos.annotation_layers where not name ~* '^[A-Za-z0-9\-_\.]+$'
        ```

### Postgres Evolutions:

- [083-unique-layer-names.sql](conf/evolutions/083-unique-layer-names.sql) Note: Note that this evolution introduces constraints which may not be met by existing data. See above for manual steps


## [22.07.0](https://github.com/scalableminds/webknossos/releases/tag/22.07.0) - 2022-06-28
[Commits](https://github.com/scalableminds/webknossos/compare/22.06.1...22.07.0)

 - FossilDB now has to be started with two new additional column families: editableMappings,editableMappingUpdates. Note that this upgrade can not be trivially rolled back, since new rocksDB column families are added and it is not easy to remove them again from an existing database. In case webKnossos needs to be rolled back, it is recommended to still keep the new column families in FossilDB. [#6195](https://github.com/scalableminds/webknossos/pull/6195)

### Postgres Evolutions:


## [22.06.1](https://github.com/scalableminds/webknossos/releases/tag/22.06.1) - 2022-06-16
[Commits](https://github.com/scalableminds/webknossos/compare/22.06.0...22.06.1)

### Postgres Evolutions:


## [22.06.0](https://github.com/scalableminds/webknossos/releases/tag/22.06.0) - 2022-05-27
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.1...22.06.0)

 - Note that the datastore API version has changed to 2.0. If you use webknossos-connect alongside your webKnossos instance, you will need to upgrade that one as well, compare [webknossos-connect#129](https://github.com/scalableminds/webknossos-connect/pull/129). [#6159](https://github.com/scalableminds/webknossos/pull/6159)

### Postgres Evolutions:
- [082-annotationsettings-volumeInterpolationAllowed.sql](conf/evolutions/082-annotationsettings-volumeInterpolationAllowed.sql)


## [22.05.1](https://github.com/scalableminds/webknossos/releases/tag/22.05.1) - 2022-04-29
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.0...22.05.1)

### Postgres Evolutions:


## [22.05.0](https://github.com/scalableminds/webknossos/releases/tag/22.05.0) - 2022-04-26
[Commits](https://github.com/scalableminds/webknossos/compare/22.04.0...22.05.0)

### Postgres Evolutions:


## [22.04.0](https://github.com/scalableminds/webknossos/releases/tag/22.04.0) - 2022-03-22
[Commits](https://github.com/scalableminds/webknossos/compare/22.03.0...22.04.0)

## [22.03.0](https://github.com/scalableminds/webknossos/releases/tag/22.03.0) - 2022-02-21
[Commits](https://github.com/scalableminds/webknossos/compare/22.02.0...22.03.0)
- The config field `googleAnalytics.trackingId` needs to be changed to [GA4 measurement id](https://support.google.com/analytics/answer/10089681), if used.

### Postgres Evolutions:
- [081-annotation-viewconfiguration.sql](conf/evolutions/081-annotation-viewconfiguration.sql)

## [22.02.0](https://github.com/scalableminds/webknossos/releases/tag/22.02.0) - 2022-01-24
[Commits](https://github.com/scalableminds/webknossos/compare/22.01.0...22.02.0)

### Postgres Evolutions:
- [080-job-add-cancelled.sql](conf/evolutions/080-job-add-cancelled.sql)

## [22.01.0](https://github.com/scalableminds/webknossos/releases/tag/22.01.0) - 2022-01-04
[Commits](https://github.com/scalableminds/webknossos/compare/21.11.0...22.01.0)
- The datastore now also needs access to a Redis database. New config fields `datastore.redis.address` and `datastore.redis.port` are required. Note that this Redis instance may be the same one the tracingstore uses, but does not have to be.

### Postgres Evolutions:
- [078-annotation-layers.sql](conf/evolutions/078-annotation-layers.sql)
- [079-add-dataset-tags.sql](conf/evolutions/079-add-dataset-tags.sql)

## [21.11.0](https://github.com/scalableminds/webknossos/releases/tag/21.11.0) - 2021-11-30
- The docker files now place the webKnossos installation under `/webknossos` instead of `/srv/webknossos`. All mounts, most importantly `/srv/webknossos/binaryData`, need to be changed accordingly.
- The entrypoint of the docker files have changed. Therefore, any existing `docker-compose.yml` setups need to be adapted. In most cases, only the `entrypoint: bin/webknossos` lines need to be removed (if existent).
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
- The config parameters `application.authentication.enableDevAutoVerify` and `application.authentication.enableDevAutoAdmin` have been removed. To enable automatic verification for user signup, set the organization’s new `enableAutoVerify` field to `true` in the database.

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
- There is now a separate module for the tracingstore, the datastore is no longer responsible for saving tracings. This module can run as a standalone application, or as a module of webKnossos locally. It is recommended that you choose the option that was previously also in place for datastores. In case of a standalone datastore, the local one needs to be disabled in application.conf: `tracingstore.enabled = false` and `play.modules.disabled += "com.scalableminds.braingames.datastore.TracingStoreModule` – and in either case, the address of the tracingstore (localhost or remote) needs to be inserted in the db in `webknossos.tracingStores`.
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

### Postgres Evolutions:
- [001-add-organizations.sql](conf/evolutions/001-add-organizations.sql)
- [002-add-dataset-urlsharing-token.sql](conf/evolutions/002-add-dataset-urlsharing-token.sql)
- [003-add-dataset-displayname.sql](conf/evolutions/003-add-dataset-displayname.sql)
- [004-add-initializing-annotation-state.sql](conf/evolutions/004-add-initializing-annotation-state.sql)
- [005-add-openinstances-trigger.sql](conf/evolutions/005-add-openinstances-trigger.sql)
- [007-unify-type-datalayer-name.sql](conf/evolutions/007-unify-type-datalayer-name.sql)
- [008-task-instances-triggers.sql](conf/evolutions/008-task-instances-triggers.sql)
- [009-remove-team-assignment-from-task.sql](conf/evolutions/009-remove-team-assignment-from-task.sql)
- [010-add-organization-data.sql](conf/evolutions/010-add-organization-data.sql)
- [011-add-isOrganizationTeam.sql](conf/evolutions/011-add-isOrganizationTeam.sql)
- [012-add-foreign-keys.sql](conf/evolutions/012-add-foreign-keys.sql)
