# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.01.0...HEAD)

### Added
- Added the possibility to add additional volume layers to an existing annotation via the left sidebar. [#5881](https://github.com/scalableminds/webknossos/pull/5881)

### Changed

### Fixed
- Fixed bug where volume data downloads would sometimes produce invalid zips due to a race condition. [#5926](https://github.com/scalableminds/webknossos/pull/5926)
- Fixed a bug which caused that the keyboard delay wasn't respected properly when rapidly pressing a key. [#5947](https://github.com/scalableminds/webknossos/pull/5947)

### Removed

### Breaking Changes
