# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.12.0...HEAD)

### Added
- Added support for S3-compliant object storage services (e.g. MinIO) as a storage backend for remote datasets. [#7453](https://github.com/scalableminds/webknossos/pull/7453)
- Added support for blosc compressed N5 datasets. [#7465](https://github.com/scalableminds/webknossos/pull/7465)
- Added route for triggering the compute segment index worker job. [#7471](https://github.com/scalableminds/webknossos/pull/7471)

### Changed

### Fixed
- Fixed several deprecation warning for using antd's Tabs.TabPane components. [#7469]

### Removed

### Breaking Changes
