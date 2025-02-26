# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.02.0...HEAD)

### Added

### Changed
- When creating multiple tasks at once (bulk task creation), they now all need to have the same task type. [#8405](https://github.com/scalableminds/webknossos/pull/8405)

### Fixed
- Fixed a bug that would lock a non existing mapping to an empty segmentation layer under certain conditions. [#8401](https://github.com/scalableminds/webknossos/pull/8401)
- Fixed a bug where reverting annotations could get stuck if some of its layers had been deleted in the meantime. [#8405](https://github.com/scalableminds/webknossos/pull/8405)

### Removed

### Breaking Changes
