# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.06.0...HEAD)

### Added
- Added the possibility for admins to set long-running jobs to a “manually repaired” state. [#5530](https://github.com/scalableminds/webknossos/pull/5530)

### Changed
- "Center new Nodes" option was renamed to "Auto-center Nodes" and changed to also influence the centering-behavior when deleting a node. [#5538](https://github.com/scalableminds/webknossos/pull/5538)
- The displayed webKnossos version now omits the parent release name for intermediate builds. [#5565](https://github.com/scalableminds/webknossos/pull/5565)

### Fixed
- Fixed that a disabled "Center new Nodes" option didn't work correctly in merger mode. [#5538](https://github.com/scalableminds/webknossos/pull/5538)
- Fixed a bug where dataset uploads of zips with just one file inside failed. [#5534](https://github.com/scalableminds/webknossos/pull/5534)
- Fixed a bug that caused a distortion when moving or zooming in the maximized 3d viewport. [#5550](https://github.com/scalableminds/webknossos/pull/5550)

### Removed
-

### Breaking Change
-
