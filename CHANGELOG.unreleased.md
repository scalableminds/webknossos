# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.0...HEAD)

### Added

### Changed
- Datasets stored in WKW format are no longer loaded with memory mapping, reducing memory demands. [#7528](https://github.com/scalableminds/webknossos/pull/7528)

### Fixed
- Fixed rare SIGBUS crashes of the datastore module that were caused by memory mapping on unstable file systems. [#7528](https://github.com/scalableminds/webknossos/pull/7528)

### Removed

### Breaking Changes
