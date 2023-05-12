# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.2...HEAD)

### Added
- Added segment groups so that segments can be organized in a hierarchy (similar to skeletons). [#6966](https://github.com/scalableminds/webknossos/pull/6966)
- In addition to drag and drop, the selected tree(s) in the Skeleton tab can also be moved into another group by right-clicking the target group and selecting "Move selected tree(s) here". [#7005](https://github.com/scalableminds/webknossos/pull/7005)
- Added support for remote datasets encoded with [brotli](https://datatracker.ietf.org/doc/html/rfc7932). [#7041](https://github.com/scalableminds/webknossos/pull/7041)
- Teams can be edited more straight-forwardly in a popup in the team edit page. [#7043](https://github.com/scalableminds/webknossos/pull/7043)

### Changed
- Loading of precomputed meshes got significantly faster (especially when using a mesh file for an oversegmentation with an applied agglomerate mapping). [#7001](https://github.com/scalableminds/webknossos/pull/7001)
- Improved speed of proofreading by only reloading affected areas after a split or merge. [#7050](https://github.com/scalableminds/webknossos/pull/7050)

### Fixed
- Fixed that changing a segment color could lead to a crash. [#7000](https://github.com/scalableminds/webknossos/pull/7000)
- The fill_value property of zarr dataset is now used when it is not a number. [#7017](https://github.com/scalableminds/webknossos/pull/7017)
- Fixed a bug that made downloads of public annotations fail occasionally. [#7025](https://github.com/scalableminds/webknossos/pull/7025)
- Fixed layouting of used storage space on the organization page. [#7034](https://github.com/scalableminds/webknossos/pull/7034)
- Fixed a bug where updating skeleton annotation tree group visibility would break the annotation. [#7037](https://github.com/scalableminds/webknossos/pull/7037)
- Fixed importing Neuroglancer Precomputed datasets that have a voxel offset in their header. [#7019](https://github.com/scalableminds/webknossos/pull/7019), [#7062](https://github.com/scalableminds/webknossos/pull/7062)
- Fixed reading Neuroglancer Precomputed datasets with non-integer resolutions. [#7041](https://github.com/scalableminds/webknossos/pull/7041)
- Fixed a bug where invalid email addresses were not readable in dark mode on the login/signup pages. [#7052](https://github.com/scalableminds/webknossos/pull/7052)
- Fixed a bug where users could sometimes not access their own time tracking information. [#7055](https://github.com/scalableminds/webknossos/pull/7055)
- Fixed a bug in the wallTime calculation of the Voxelytics reports. [#7059](https://github.com/scalableminds/webknossos/pull/7059) 
- Fixed a bug where thumbnails and raw data requests with non-bucket-aligned positions would show data at slightly wrong positions. [#7058](https://github.com/scalableminds/webknossos/pull/7058)
- Avoid crashes when exporting big STL files. [#7074](https://github.com/scalableminds/webknossos/pull/7074)

### Removed

### Breaking Changes
