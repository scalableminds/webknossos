# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.1...HEAD)

### Added
- Added segment groups so that segments can be organized in a hierarchy (similar to skeletons). [#6966](https://github.com/scalableminds/webknossos/pull/6966)
- In addition to drag and drop, the selected tree(s) in the Skeleton tab can also be moved into another group by right-clicking the target group and selecting "Move selected tree(s) here". [#7005](https://github.com/scalableminds/webknossos/pull/7005)
- Added a machine-learning based quick select mode. Activate it via the "AI" button in the toolbar after selecting the quick-select tool. [#7051](https://github.com/scalableminds/webknossos/pull/7051)

### Changed

### Fixed
- Fixed that changing a segment color could lead to a crash. [#7000](https://github.com/scalableminds/webknossos/pull/7000)
- The fill_value property of zarr dataset is now used when it is not a number. [#7017](https://github.com/scalableminds/webknossos/pull/7017)
- Fixed a bug that made downloads of public annotations fail occasionally. [#7025](https://github.com/scalableminds/webknossos/pull/7025)
- Fixed layouting of used storage space on the organization page. [#7034](https://github.com/scalableminds/webknossos/pull/7034)
- Fixed a bug where updating skeleton annotation tree group visibility would break the annotation. [#7037](https://github.com/scalableminds/webknossos/pull/7037)
- Fixed importing Neuroglancer Precomputed datasets that have a voxel offset in their header. [#7019](https://github.com/scalableminds/webknossos/pull/7019)

### Removed

### Breaking Changes
