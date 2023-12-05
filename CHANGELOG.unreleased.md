# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.11.0...HEAD)

### Added
- Zarr datasets can now be directly uploaded to WEBKNOSSOS. [#7397](https://github.com/scalableminds/webknossos/pull/7397)
- Added support for reading uint24 rgb layers in datasets with zarr2/zarr3/n5/neuroglancerPrecomputed format, as used for voxelytics predictions. [#7413](https://github.com/scalableminds/webknossos/pull/7413)
- Adding a remote dataset can now be done by providing a Neuroglancer URI. [#7416](https://github.com/scalableminds/webknossos/pull/7416)
- Added a filter to the Task List->Stats column to quickly filter for tasks with "Pending", "In-Progress" or "Finished" instances. [#7430](https://github.com/scalableminds/webknossos/pull/7430)
- Added support for S3-compliant object storage services (e.g. MinIO) as a storage backend for remote datasets. [#7453](https://github.com/scalableminds/webknossos/pull/7453)
- Added support for blosc compressed N5 datasets. [#7465](https://github.com/scalableminds/webknossos/pull/7465)

### Changed
- An appropriate error is returned when requesting an API version that is higher that the current version. [#7424](https://github.com/scalableminds/webknossos/pull/7424)
- Upgraded FossilDB database used to store annotation data to version 0.1.27. [#7440](https://github.com/scalableminds/webknossos/pull/7440)

### Fixed
- Searching the segments in the sidebar will highlight newly focused segments properly now. [#7406](https://github.com/scalableminds/webknossos/pull/7406)
- Fixed a bug when opening a task for which a mag restriction exists. The bug only occurred when the referenced mag didn't exist in the dataset. [#7403](https://github.com/scalableminds/webknossos/pull/7403)
- Fixed that trees with ids around 1023 were invisible on some systems. [#7443](https://github.com/scalableminds/webknossos/pull/7443)
- Fixed styling issues with the maintenance banner so that it no longer overlaps other menus, tabs, and buttons. [#7421](https://github.com/scalableminds/webknossos/pull/7421)
- Exploring HTTP uris of unknown hosts no longer causes an exception error message to be displayed. [#7422](https://github.com/scalableminds/webknossos/pull/7422)
- Fixed the initialization of the dark theme if it was active during page load. [#7446](https://github.com/scalableminds/webknossos/pull/7446)
- Fixed a rare bug in ad-hoc meshing for voxelytics-created segmentations with agglomerate mappings. [#7449](https://github.com/scalableminds/webknossos/pull/7449)
- Fixed several deprecation warning for using antd's Tabs.TabPane components. [#7469]
- The settings page for non-wkw datasets no longer shows a wall of non-applying errors. [#7475](https://github.com/scalableminds/webknossos/pull/7475)

### Removed

### Breaking Changes
