# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.05.0...HEAD)

### Added

- Added the possibility to select hour, minute and second of the time range in the timetracking view. [#4604](https://github.com/scalableminds/webknossos/pull/4604)
- Volume tracing data is now saved with lz4 compression, reducing I/O load and required disk space. [#4602](https://github.com/scalableminds/webknossos/pull/4602)

### Changed
- Improved the UI in navigation bar during loading of tracings and datasets. [#4612](https://github.com/scalableminds/webknossos/pull/4612)
- Improved logging in case of very slow annotation saving. Additionally, the user is also warned when there are unsaved changes older than two minutes. [#4593](https://github.com/scalableminds/webknossos/pull/4593)
- REST API for creating / changing datastores now contains additional field `allowsUpload` denoting if the datastore allows uploading datasets via browser. [#4614](https://github.com/scalableminds/webknossos/pull/4614)

### Fixed

- When activating an agglomerate file-based ID mapping, only the segmentation layer will be reloaded from now on. This will improve mapping activation performance. [#4600](https://github.com/scalableminds/webknossos/pull/4600)
- Fixed retrying of failed save requests sent during tracingstore restart. [#4591](https://github.com/scalableminds/webknossos/pull/4591)
- Fixed the initial loading of agglomerate mappings, where some buckets remained black. [#4601](https://github.com/scalableminds/webknossos/pull/4601)
- Fixed occasional error during loading of compound annotations (such as viewing multiple finished task instances in one view). [#4619](https://github.com/scalableminds/webknossos/pull/4619)

### Removed

-

