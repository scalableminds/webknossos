# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.09.0...HEAD)

### Added
- Added a new bounding box tool that allows resizing and creating bounding boxes more easily. Additionally, the context menu now contains options to modify the bounding box close to the clicked position. [#5767](https://github.com/scalableminds/webknossos/pull/5767)
- Activate the correct mapping before loading pre-computed meshes if the corresponding mesh file contains that information. [#5859](https://github.com/scalableminds/webknossos/pull/5859)

### Changed
- The docker setup has been restructured, which requires changes to existing docker-compose setups. See the migration guide for details. [#5843](https://github.com/scalableminds/webknossos/pull/5843)
- By default, if data is missing in one magnification, higher magnifications are used for rendering. This setting can be controlled via the left sidebar under "Render Missing Data Black". [#5862](https://github.com/scalableminds/webknossos/pull/5862)
- Made the `w` shortcut to cycle through the tools non-looping. [#5865](https://github.com/scalableminds/webknossos/pull/5865)
- The communication with webknossos-worker for long-running jobs no longer uses flower/celery, but instead webKnossos itself assigns jobs to polling workers. [#5834](https://github.com/scalableminds/webknossos/pull/5834)

### Fixed
- Fixed a bug that the displayed value range of a histogram of a color layer wasn't applied until the slider was dragged a bit. [#5853](https://github.com/scalableminds/webknossos/pull/5853)
- Fixed a bug where admins could not share annotations with teams they were not explicitly a member of. [#5845](https://github.com/scalableminds/webknossos/pull/5845)

### Removed
- Removed `1` shortcut which allowed to cycle through the tools but only if some of the tools were active. Use `w` instead. [#5865](https://github.com/scalableminds/webknossos/pull/5865)

### Breaking Change
-
