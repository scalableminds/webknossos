# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.1...HEAD)

### Added
 - Added support to stream zarr files using the corresponding [zarr spec](https://zarr.readthedocs.io/en/stable/spec/v2.html#storage). [#6144](https://github.com/scalableminds/webknossos/pull/6144)

### Changed
- Changed the internal protocol for requesting image data. The zoomStep parameter has been replaced by mag. This increases the datastore API version to 2.0 [#6159](https://github.com/scalableminds/webknossos/pull/6159)
- In annotation list in dashboard, replaced the non-standard word “Trace” by “Open”. [#6191](https://github.com/scalableminds/webknossos/pull/6191)

### Fixed
- Fixed a bug in the task cration, where creation for some tasks with initial volume data would fail. [#6178](https://github.com/scalableminds/webknossos/pull/6178)

### Removed

### Breaking Changes
