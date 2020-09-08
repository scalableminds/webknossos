# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.07.0...HEAD)

### Added
- Added the possibility to merge volume tracings both via file upload (zip of zips) and when viewing projects/tasks as compound annotations. [#4709](https://github.com/scalableminds/webknossos/pull/4709)
- Added the possibility to remove the fallback segmentation layer from a hybrid/volume tracing. Accessible by a minus button next to the layer's settings. [#4741](https://github.com/scalableminds/webknossos/pull/4766)
- Added the possibility to undo and redo volume annotation strokes. [#4771](https://github.com/scalableminds/webknossos/pull/4771)
- Added the possibility to navigate to the preceding/subsequent node by pressing "ctrl + ," or "ctrl + ." in a skeleton tracing. [#4147](https://github.com/scalableminds/webknossos/pull/4784)

### Changed
-

### Fixed
- Improved the data loading behavior for flight and oblique mode. [#4800](https://github.com/scalableminds/webknossos/pull/4800)
- Fixed a bug where some volume annotations that had been reverted to a previous version became un-downloadable. [#4805](https://github.com/scalableminds/webknossos/pull/4805)
- Fixed a UI bug where some tooltip wouldn't close after editing a label. [#4815](https://github.com/scalableminds/webknossos/pull/4815)

### Removed
-
