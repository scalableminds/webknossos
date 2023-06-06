# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.06.0...HEAD)

### Added
- Subfolders of the currently active folder are now also rendered in the dataset table in the dashboard. [#6996](https://github.com/scalableminds/webknossos/pull/6996)
- Add ability to view [zarr v3](https://zarr-specs.readthedocs.io/en/latest/v3/core/v3.0.html) datasets. [#7079](https://github.com/scalableminds/webknossos/pull/7079)

### Changed

### Fixed
- Fixed a bug where some volume annotations could not be downloaded. [#7115](https://github.com/scalableminds/webknossos/pull/7115)
- Fixed reading of some remote datasets where invalid data would follow valid gzip data, causing the decompression to fail. [#7119](https://github.com/scalableminds/webknossos/pull/7119)
- Fixed some requests failing for streaming remote data via HTTP, which was observed when streaming data via Zarr from another WEBKNOSSOS instance. [#7125](https://github.com/scalableminds/webknossos/pull/7125)

### Removed
- Support for [webknososs-connect](https://github.com/scalableminds/webknossos-connect) data store servers has been removed. Use the "Add Remote Dataset" functionality instead. [#7031](https://github.com/scalableminds/webknossos/pull/7031)

### Breaking Changes
