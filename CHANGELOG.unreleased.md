# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.12.0...HEAD)

### Added
- The data of segments can now be deleted in the segment side panel. [#7435](https://github.com/scalableminds/webknossos/pull/7435)
- Added support for S3-compliant object storage services (e.g. MinIO) as a storage backend for remote datasets. [#7453](https://github.com/scalableminds/webknossos/pull/7453)
- Added support for blosc compressed N5 datasets. [#7465](https://github.com/scalableminds/webknossos/pull/7465)
- Added route for triggering the compute segment index worker job. [#7471](https://github.com/scalableminds/webknossos/pull/7471)
- Added thumbnails to the dashboard dataset list. [#7479](https://github.com/scalableminds/webknossos/pull/7479)
- Added the option to configure the name of the output segmentation layer in the neuron inferral job. [#7472](https://github.com/scalableminds/webknossos/pull/7472)
- Adhoc mesh rendering is now available for ND datasets.[#7394](https://github.com/scalableminds/webknossos/pull/7394)
- Added the ability to compose a new dataset from existing dataset layers. This can be done with or without transforms (transforms will be derived from landmarks given via BigWarp CSV or WK NMLs). [#7395](https://github.com/scalableminds/webknossos/pull/7395)
- When setting up WEBKNOSSOS from the git repository for development, the organization directory for storing datasets is now automatically created on startup. [#7517](https://github.com/scalableminds/webknossos/pull/7517)
- Multiple segments can be dragged and dropped in the segments tab. [#7536](https://github.com/scalableminds/webknossos/pull/7536)
- Added the option to convert agglomerate skeletons to freely modifiable skeletons in the context menu of the Skeleton tab. [#7537](https://github.com/scalableminds/webknossos/pull/7537)
- The annotation list in the dashboard now also shows segment counts of volume annotations (after they have been edited). [#7548](https://github.com/scalableminds/webknossos/pull/7548)
- The buildinfo route now reports the supported HTTP API versions. [#7581](https://github.com/scalableminds/webknossos/pull/7581)
- After deleting specific teams, projects and task types, their names can now be re-used when creating new ones. [#7573](https://github.com/scalableminds/webknossos/pull/7573)

### Changed
- Improved loading speed of the annotation list. [#7410](https://github.com/scalableminds/webknossos/pull/7410)
- Improved loading speed for the users list. [#7466](https://github.com/scalableminds/webknossos/pull/7466)
- Admins and Team Managers can now also download job exports for jobs of other users, if they have the link. [#7462](https://github.com/scalableminds/webknossos/pull/7462)
- Updated some dependencies of the backend code (play 2.9, sbt 1.9, minor upgrades for others) for optimized performance. [#7366](https://github.com/scalableminds/webknossos/pull/7366)
- Processing jobs can now be distributed to multiple webknossos-workers with finer-grained configurability. Compare migration guide. [#7463](https://github.com/scalableminds/webknossos/pull/7463)
- Removed Swagger/OpenAPI json description of the HTTP API. [#7494](https://github.com/scalableminds/webknossos/pull/7494)
- A warning is shown when the user tries to annotate volume data in the "Overwrite Empty" mode when no voxels were changed. [#7526](https://github.com/scalableminds/webknossos/pull/7526)
- Updated antd UI library from version 4.24.8 to 4.24.15. [#7505](https://github.com/scalableminds/webknossos/pull/7505)
- Changed the default dataset search mode to also search in subfolders. [#7539](https://github.com/scalableminds/webknossos/pull/7539)
- When clicking a segment in the viewport, it is automatically focused in the segment list. A corresponding context menu entry was added as well. [#7512](https://github.com/scalableminds/webknossos/pull/7512)
- Updated the isValidName route in the API to return 200 for valid and invalid names. With this, the API version was bumped up to 6. [#7550](https://github.com/scalableminds/webknossos/pull/7550)
- Upgraded to Play 3. [#7562](https://github.com/scalableminds/webknossos/pull/7562)
- When no Email Address for New-User Notifications is configured, the organization owner will be notified. For overtime notifications, the project owner and the organization owner will be notified. [#7561](https://github.com/scalableminds/webknossos/pull/7561)
- The metadata for ND datasets and their annotation has changed: upper bound of additionalAxes is now stored as an exclusive value, called "end" in the NML format. [#7547](https://github.com/scalableminds/webknossos/pull/7547)
- Added support for the *index_location* parameter in sharded Zarr 3 datasets. [#7553](https://github.com/scalableminds/webknossos/pull/7553)

### Fixed
- Datasets with annotations can now be deleted. The concerning annotations can no longer be viewed but still be downloaded. [#7429](https://github.com/scalableminds/webknossos/pull/7429)
- Fixed several deprecation warnings for using antd's Tabs.TabPane components. [#7469](https://github.com/scalableminds/webknossos/pull/7469)
- Fixed problems when requests for loading data failed (could impact volume data consistency and rendering). [#7477](https://github.com/scalableminds/webknossos/pull/7477)
- The settings page for non-wkw datasets no longer shows a wall of non-applying errors. [#7475](https://github.com/scalableminds/webknossos/pull/7475)
- Fixed a bug where dataset deletion for ND datasets and datasets with coordinate transforms would not free the name even if no referencing annotations exist. [#7495](https://github.com/scalableminds/webknossos/pull/7495)
- Fixed a bug where the URL in the sharing link was wrongly decoded before encoding into a URI. [#7502](https://github.com/scalableminds/webknossos/pull/7502)
- Fixed a bug where loaded meshes were not encoded in the sharing link. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed a bug where meshes (or chunks of them) were always colored white, if they were loaded while the corresponding segmentation layer was disabled. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed a race condition when opening a short link, that would sometimes lead to an error toast. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed that the Segment Statistics feature was not available in the context menu of segment groups and in the context menu of the data viewports. [#7510](https://github.com/scalableminds/webknossos/pull/7510)
- Fixed rare bug which produced a benign error toast on some mouse interactions. [#7525](https://github.com/scalableminds/webknossos/pull/7525)
- Fixed a bug where dataset managers were not allowed to assign teams to new datasets that they are only member of. This already worked while editing the dataset later, but not during upload. [#7518](https://github.com/scalableminds/webknossos/pull/7518)
- Fixed regression in proofreading tool when automatic mesh loading was disabled and a merge/split operation was performed. [#7534](https://github.com/scalableminds/webknossos/pull/7534)
- Fixed that last dimension value in ND dataset was not loaded. [#7535](https://github.com/scalableminds/webknossos/pull/7535)
- Fixed the initialization of the mapping list for agglomerate views if json mappings are present. [#7537](https://github.com/scalableminds/webknossos/pull/7537)
- Fixed a bug where uploading ND volume annotations would lead to errors due to parsing of the chunk paths. [#7547](https://github.com/scalableminds/webknossos/pull/7547)
- Fixed a bug where listing the annotations of other users would result in empty lists even if there are annotations and you should be allowed to see them. [#7563](https://github.com/scalableminds/webknossos/pull/7563)
- Fixed the "Download Meshes" functionality which was affected by the recent introduction of the CSP. [#7577](https://github.com/scalableminds/webknossos/pull/7577)
- Fixed a bug where listing the annotations of other users would result in empty lists even if there are annotations, and you should be allowed to see them. [#7563](https://github.com/scalableminds/webknossos/pull/7563)
- Fixed errors showing when viewing the annotation list. [#7579](https://github.com/scalableminds/webknossos/pull/7579)

### Removed
- Removed several unused frontend libraries. [#7521](https://github.com/scalableminds/webknossos/pull/7521)

### Breaking Changes
