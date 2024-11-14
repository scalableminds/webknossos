# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.11.1...HEAD)

### Added

### Changed
- Reading image files on datastore filesystem is now done asynchronously. [#8126](https://github.com/scalableminds/webknossos/pull/8126)

### Fixed
- Fix performance bottleneck when deleting a lot of trees at once. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fix a bug when importing an NML with groups when only groups but no trees exist in an annotation. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fix a bug where trying to delete a non-existing node (via the API, for example) would delete the whole active tree. [#8176](https://github.com/scalableminds/webknossos/pull/8176)

### Removed

### Breaking Changes
