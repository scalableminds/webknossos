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
- Improve error logging for unhandled rejections. [#5575](https://github.com/scalableminds/webknossos/pull/5575)
- Improved dragging behavior of trees/groups in the tree tab. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- "Center new Nodes" option was renamed to "Auto-center Nodes" and changed to also influence the centering-behavior when deleting a node. [#5538](https://github.com/scalableminds/webknossos/pull/5538)
- The displayed webKnossos version now omits the parent release name for intermediate builds. [#5565](https://github.com/scalableminds/webknossos/pull/5565)

### Fixed
- Fixed that a disabled "Center new Nodes" option didn't work correctly in merger mode. [#5538](https://github.com/scalableminds/webknossos/pull/5538)
- Fixed a bug where dataset uploads of zips with just one file inside failed. [#5534](https://github.com/scalableminds/webknossos/pull/5534)
- Fixed crashing tree tab which could happen when dragging a node and then switching directly to another tab (e.g., comments) and then back again. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed that the UI allowed mutating trees in the tree tab (dragging/creating/deleting trees and groups) in read-only tracings. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed "Create a new tree group for this file" setting in front-end import when a group id of 0 was used in the NML. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed a bug that caused a distortion when moving or zooming in the maximized 3d viewport. [#5550](https://github.com/scalableminds/webknossos/pull/5550)

### Removed
-

### Breaking Change
-
