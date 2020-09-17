# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.07.0...HEAD)

### Added
- Isosurface generation now also supports volume tracings without fallback layer. [#4567](https://github.com/scalableminds/webknossos/pull/4567)
- Added a tool to initiate a flood fill in a volume tracing with the active cell id. [#4780](https://github.com/scalableminds/webknossos/pull/4780)
- Added the possibility to merge volume tracings both via file upload (zip of zips) and when viewing projects/tasks as compound annotations. [#4709](https://github.com/scalableminds/webknossos/pull/4709)
- Added the possibility to remove the fallback segmentation layer from a hybrid/volume tracing. Accessible by a minus button next to the layer's settings. [#4741](https://github.com/scalableminds/webknossos/pull/4766)
- Added the possibility to undo and redo volume annotation strokes. [#4771](https://github.com/scalableminds/webknossos/pull/4771)
- Added the possibility to navigate to the preceding/subsequent node by pressing "ctrl + ," or "ctrl + ." in a skeleton tracing. [#4147](https://github.com/scalableminds/webknossos/pull/4784)

### Changed
- When d/f switching is turned off and a slice is copied with the shortcut `v`, the previous slice used as the source will always be slice - 1 and `shift + v` will always take slice + 1 as the slice to copy from. [#4728](https://github.com/scalableminds/webknossos/pull/4728)
- Disabled the autofill feature of the brush when using this tool to erase data. [#4729](https://github.com/scalableminds/webknossos/pull/4729)
- The rotation buttons of the 3D-viewport no longer change the zoom. [#4750](https://github.com/scalableminds/webknossos/pull/4750)
- Improved the performance of applying agglomerate files. [#4706](https://github.com/scalableminds/webknossos/pull/4706)
- When uploading tasks via NML, NML are shown in the task modal instead of a toast. [#4723](https://github.com/scalableminds/webknossos/pull/4723)

### Fixed
- Improved the data loading behavior for flight and oblique mode. [#4800](https://github.com/scalableminds/webknossos/pull/4800)
- Fixed an issue where in some cases the tree list was only visible after the window was resized. [#4816](https://github.com/scalableminds/webknossos/pull/4816)
- Fixed a bug where some volume annotations that had been reverted to a previous version became un-downloadable. [#4805](https://github.com/scalableminds/webknossos/pull/4805)
- Fixed a UI bug where some tooltip wouldn't close after editing a label. [#4815](https://github.com/scalableminds/webknossos/pull/4815)

### Removed
-
