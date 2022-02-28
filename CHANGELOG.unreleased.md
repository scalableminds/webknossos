# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/release-YY.MM...HEAD)

### Added
- The visible meshes are now included in the link copied from the "Share" modal or the "Share" button next to the dataset position. They are automatically loaded for users that open the shared link. [#5993](https://github.com/scalableminds/webknossos/pull/5993)

### Changed
- The maximum brush size now depends on the available magnifications. Consequentially, one can use a larger brush size when the magnifications of a volume layer are restricted. [#6066](https://github.com/scalableminds/webknossos/pull/6066)
- Improved stability and speed of volume annotations when annotating large areas. [#6055](https://github.com/scalableminds/webknossos/pull/6055)

### Fixed
- Fixed a bug that led to crashing the layer settings once the icon for the downsample modal was clicked. [#6058](https://github.com/scalableminds/webknossos/pull/6058)
- Fixed a bug where toggling between not archived and archived annotations in the "My Annotation" of the dashboard led to inconsistent states and duplicates of annotations. [#6058](https://github.com/scalableminds/webknossos/pull/6058)
- Fixed a bug where deactivated users would still be listed as allowed to access the datasets of their team. [#6070](https://github.com/scalableminds/webknossos/pull/6070)
- Fix occasionally "disappearing" data. [#6055](https://github.com/scalableminds/webknossos/pull/6055)

### Removed
- The previously disabled Import Skeleton Button has been removed. The functionality is available via the context menu for datasets with active ID mappings. [#6073](https://github.com/scalableminds/webknossos/pull/6073)

### Breaking Changes
