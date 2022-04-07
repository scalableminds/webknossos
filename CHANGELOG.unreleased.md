# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.04.0...HEAD)

### Added

### Changed
- Various changes to the Dataset table in the dashboard  [#6131](https://github.com/scalableminds/webknossos/pull/6131):
  - Renamed "Allowed Teams" column to "Access Permissions".
  - Add filter functionality to "Access Permissions" column to filter for public datasets.
  - Removed `isActive` and `isPublic` columns to save screen space.
  - Changed data layer entries to display layer names instead of categories, e.g. "color" --> "axons".

### Fixed
- Fixed a bug that led to an error when drag-'n-dropping an empty volume annotation in the dataset view. [#6116](https://github.com/scalableminds/webknossos/pull/6116)
- Fixed rare callstack overflow when annotating large areas. [#6076](https://github.com/scalableminds/webknossos/pull/6076)
- Fixed the "Copy Slice" shortcut (`v` and `shift + v`) in resolutions other than the most detailed one. [#6130](https://github.com/scalableminds/webknossos/pull/6130)

### Removed

### Breaking Changes
