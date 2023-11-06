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

### Changed

### Fixed
- Searching the segments in the sidebar will highlight newly focused segments properly now. [#7406](https://github.com/scalableminds/webknossos/pull/7406)
- Fixed a bug when opening a task for which a mag restriction exists. The bug only occurred when the referenced mag didn't exist in the dataset. [#7403](https://github.com/scalableminds/webknossos/pull/7403)
- Fixed styling issues with the maintenance banner so that it no longer overlaps other menus, tabs, and buttons. [#7421](https://github.com/scalableminds/webknossos/pull/7421)
- Exploring HTTP uris of unknown hosts no longer causes an exception error message to be displayed. [#7422](https://github.com/scalableminds/webknossos/pull/7422)

### Removed

### Breaking Changes
