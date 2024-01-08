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
- Adhoc mesh rendering is now available for ND datasets.[#7394](https://github.com/scalableminds/webknossos/pull/7394)

### Changed
- Improved loading speed of the annotation list. [#7410](https://github.com/scalableminds/webknossos/pull/7410)
- Admins and Team Managers can now also download job exports for jobs of other users, if they have the link. [#7462](https://github.com/scalableminds/webknossos/pull/7462)
- Updated some dependencies of the backend code (play 2.9, sbt 1.9, minor upgrades for others) for optimized performance. [#7366](https://github.com/scalableminds/webknossos/pull/7366)
- Processing jobs can now be distributed to multiple webknossos-workers with finer-grained configurability. Compare migration guide. [#7463](https://github.com/scalableminds/webknossos/pull/7463)
- Removed Swagger/OpenAPI json description of the HTTP API. [#7494](https://github.com/scalableminds/webknossos/pull/7494)
- A warning is shown when the user tries to annotate volume data in the "Overwrite Empty" mode when no voxels were changed. [#7526](https://github.com/scalableminds/webknossos/pull/7526)

### Fixed
- Datasets with annotations can now be deleted. The concerning annotations can no longer be viewed but still be downloaded. [#7429](https://github.com/scalableminds/webknossos/pull/7429)
- Fixed several deprecation warning for using antd's Tabs.TabPane components. [#7469](https://github.com/scalableminds/webknossos/pull/7469)
- Fixed problems when requests for loading data failed (could impact volume data consistency and rendering). [#7477](https://github.com/scalableminds/webknossos/pull/7477)
- The settings page for non-wkw datasets no longer shows a wall of non-applying errors. [#7475](https://github.com/scalableminds/webknossos/pull/7475)
- Fixed a bug where dataset deletion for ND datasets and datasets with coordinate transforms would not free the name even if no referencing annotations exist. [#7495](https://github.com/scalableminds/webknossos/pull/7495)
- Fixed a bug where the URL in the sharing link was wrongly decoded before encoding into a URI. [#7502](https://github.com/scalableminds/webknossos/pull/7502)
- Fixed a bug where loaded meshes were not encoded in the sharing link. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed a bug where meshes (or chunks of them) were always colored white, if they were loaded while the corresponding segmentation layer was disabled. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed a race condition when opening a short link, that would sometimes lead to an error toast. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed that the Segment Statistics feature was not available in the context menu of segment groups and in the context menu of the data viewports. [#7510](https://github.com/scalableminds/webknossos/pull/7510)

### Removed

### Breaking Changes
