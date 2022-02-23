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

### Fixed
- Fixed a bug that lead to crashing the layer settings once the icon for the downsample modal was clicked. [#6058](https://github.com/scalableminds/webknossos/pull/6058)
- Fixed a bug where toggling between not archived and archived annotations in the "My Annotation" of the dashboard lead to inconsistent states and duplicates of annotations. [#6058](https://github.com/scalableminds/webknossos/pull/6058)
- Fixed a bug where deactivated users would still be listed as allowed to access the datasets of their team. [#6070](https://github.com/scalableminds/webknossos/pull/6070)

### Removed

### Breaking Changes
