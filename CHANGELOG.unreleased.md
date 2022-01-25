# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.02.0...HEAD)

### Added

### Changed
- Upgraded webpack build tool to v5 and all other webpack related dependencies to their latest version. Enabled persistent caching which speeds up server restarts during development as well as production builds. [#5969](https://github.com/scalableminds/webknossos/pull/5969)
- The front-end API `labelVoxels` returns a promise now which fulfills as soon as the label operation was carried out. [#5955](https://github.com/scalableminds/webknossos/pull/5955)

### Fixed
- Fixed volume-related bugs which could corrupt the volume data in certain scenarios. [#5955](https://github.com/scalableminds/webknossos/pull/5955)

### Removed

### Breaking Changes
