# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.09.0...HEAD)

### Added
- Enhanced the volume fill tool to so that it operates beyond the dimensions of the current viewport. Additionally, the fill tool can also be changed to perform in 3D instead of 2D. [#5733](https://github.com/scalableminds/webknossos/pull/5733)

### Changed
-

### Fixed
- Fixed two volume tracing related bugs which could occur when using undo with a slow internet connection or when volume-annotating more than 5000 buckets (32**3 vx) in one session. [#5728](https://github.com/scalableminds/webknossos/pull/5728)
- Jobs status is no longer polled if jobs are not enabled, avoiding backend logging spam [#5761](https://github.com/scalableminds/webknossos/pull/5761)
- Fixed a bug that windows user could not open the context menu as it instantly closed after opening. [#5756](https://github.com/scalableminds/webknossos/pull/5756).
- Fixed a bug where the health check of public datasets failed if no cookie/token was supplied. [#5768](https://github.com/scalableminds/webknossos/pull/5768).

### Removed
-

### Breaking Change
-
