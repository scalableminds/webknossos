# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.03.0...HEAD)

### Added
- Added the possibility to upload datasets without zipping them first. [#5137](https://github.com/scalableminds/webknossos/pull/5137)
- Added CTRL+Scroll for zooming, which enables pinch-to-zoom on some trackpads. [#5224](https://github.com/scalableminds/webknossos/pull/5224)
- The time spent on a project is now displayed in the project list. [#5209](https://github.com/scalableminds/webknossos/pull/5209)
- Added the possibility to export binary data as tiff (if long-runnings jobs are enabled). [#5195](https://github.com/scalableminds/webknossos/pull/5195)
- Added a link to dataset view mode from annotation mode info tab. [#5262](https://github.com/scalableminds/webknossos/pull/5262)
- Added the possibility to export also volume annotations as tiff (if long-runnings jobs are enabled). [#5246](https://github.com/scalableminds/webknossos/pull/5246)
- WKW Dataset uploads with missing mag or layer dir no longer fail, instead the paths are automatically added (defaults to color/1). [#5285](https://github.com/scalableminds/webknossos/pull/5285)

### Changed
- Measured distances will be shown in voxel space, too. [#5240](https://github.com/scalableminds/webknossos/pull/5240)

### Fixed
- Fixed a regression in the task search which could lead to a frontend crash. [#5267](https://github.com/scalableminds/webknossos/pull/5267)
- Fixed a rendering bug in oblique mode. [#5289](https://github.com/scalableminds/webknossos/pull/5289)
- Fixed a bug where uploading NMLs from dashboard via file picker was inaccessible. [#5308](https://github.com/scalableminds/webknossos/pull/5308)

### Removed
-

### Breaking Change
- The front-end API methods `measurePathLengthBetweenNodes`, `measureAllTrees` and `measureTreeLength` were changed to return a tuple containing the distance in nm and in vx (instead of only returning the distance in nm). [#5240](https://github.com/scalableminds/webknossos/pull/5240)
