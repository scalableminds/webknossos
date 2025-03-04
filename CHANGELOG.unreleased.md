# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.02.1...HEAD)

### Added

### Changed
- When using a zarr link to a wk-served data layer as another layer’s source, the user’s token is used to access the data. [#8322](https://github.com/scalableminds/webknossos/pull/8322/)
- Compound annotations (created when viewing all annotations of a task) no longer permanently store data in the FossilDB. [#8422](https://github.com/scalableminds/webknossos/pull/8422)
- When creating multiple tasks at once (bulk task creation), they now all need to have the same task type. [#8405](https://github.com/scalableminds/webknossos/pull/8405)

### Fixed
- Fixed a bug that would lock a non-existing mapping to an empty segmentation layer under certain conditions. [#8401](https://github.com/scalableminds/webknossos/pull/8401)
- Fixed the alignment of the button that allows restricting floodfill operations to a bounding box. [#8388](https://github.com/scalableminds/webknossos/pull/8388) 
- Fixed rare bug where saving got stuck. [#8409](https://github.com/scalableminds/webknossos/pull/8409)
- Fixed a bug where reverting annotations could get stuck if some of its layers had been deleted in the meantime. [#8405](https://github.com/scalableminds/webknossos/pull/8405)
- Fixed a bug where newly added remote datasets added would always appear in root folder, regardless of actual selected folder. [#8425](https://github.com/scalableminds/webknossos/pull/8425)
- Fixed a bug where the python libs functionality `wk.RemoteDataset.explore_and_add_remote` would error. [#8425](https://github.com/scalableminds/webknossos/pull/8425)

### Removed

### Breaking Changes
