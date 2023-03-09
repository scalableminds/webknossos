# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.03.0...HEAD)

### Added
- Added support for remote Zarr datasets with a `datasource-properties.json` as created by the WEBKNOSSOS Python library. [#6879](https://github.com/scalableminds/webknossos/pull/6879)

### Changed
- Upgraded antd UI library to v4.24.8 [#6865](https://github.com/scalableminds/webknossos/pull/6865)
- The view mode dropdown was slimmed down by using icons to make the toolbar more space efficient. [#6900](https://github.com/scalableminds/webknossos/pull/6900)

### Fixed
- Fixed a bug where N5 datasets reading with end-chunks that have a chunk size differing from the metadata-supplied chunk size would fail for some areas. [#6890](https://github.com/scalableminds/webknossos/pull/6890)
- Fixed potential crash when trying to edit certain annotation properties of a shared annotation. [#6892](https://github.com/scalableminds/webknossos/pull/6892)
- Fixed a bug where merging multiple volume annotations would result in inconsistent segment lists. [#6882](https://github.com/scalableminds/webknossos/pull/6882)
- Fixed a bug where uploading multiple annotations with volume layers at once would fail. [#6882](https://github.com/scalableminds/webknossos/pull/6882)
- Fixed a bug where dates were formatted incorrectly in Voxelytics reports. [#6908](https://github.com/scalableminds/webknossos/pull/6908)

### Removed

### Breaking Changes
