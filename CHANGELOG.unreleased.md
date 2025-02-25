# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.02.0...HEAD)

### Added

### Changed
- When using a zarr link to a wk-served data layer as another layer’s source, the user’s token is used to access the data. [#8322](https://github.com/scalableminds/webknossos/pull/8322/)

### Fixed
- Fixed a bug that would lock a non existing mapping to an empty segmentation layer under certain conditions. [#8401](https://github.com/scalableminds/webknossos/pull/8401)
- Fixed the alignment of the button that allows restricting floodfill operations to a bounding box. [#8388](https://github.com/scalableminds/webknossos/pull/8388) 

### Removed

### Breaking Changes
