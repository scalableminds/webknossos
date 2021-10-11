# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.09.0...HEAD)

### Added
-

### Changed
-

### Fixed
- Jobs status is no longer polled if jobs are not enabled, avoiding backend logging spam [#5761](https://github.com/scalableminds/webknossos/pull/5761)
- Fixed a bug that windows user could not open the context menu as it instantly closed after opening. [#5756](https://github.com/scalableminds/webknossos/pull/5756).
- Fixed a bug where the health check of public datasets failed if no cookie/token was supplied. [#5768](https://github.com/scalableminds/webknossos/pull/5768).

### Removed
-

### Breaking Change
-
