# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.07.0...HEAD)

### Added
- Added the possibility to move nodes in skeleton tracings. This can be done either by pressing CTRL + arrow key or by dragging while holding CTRL. [#4743](https://github.com/scalableminds/webknossos/pull/4743)
- Added the possibility to delete datasets on disk from webKnossos. Use with care. [#4696](https://github.com/scalableminds/webknossos/pull/4696)
- Added error toasts for failing bucket requests. [#4740](https://github.com/scalableminds/webknossos/pull/4740)
- Added the possibility to remove the fallback segmentation layer from a hybrid/volume tracing. Accessible by a minus button next to the layer's settings. [#4741](https://github.com/scalableminds/webknossos/pull/4766)
- Improved the distinguishability of segments by improving the color generation and also by rendering patterns within the segments. The pattern opacity can be adapted in the layer settings (next to the opacity of the segmentation layer). [#4730](https://github.com/scalableminds/webknossos/pull/4730)
- Added a list of all projects containing tasks of a specific task type. It's accessible from the task types list view. [#4420](https://github.com/scalableminds/webknossos/pull/4745)

### Changed
- When d/f switching is turned off and a slice is copied with the shortcut `v`, the previous slice used as the source will always be slice - 1 and `shift + v` will always take slice + 1 as the slice to copy from. [#4728](https://github.com/scalableminds/webknossos/pull/4728)
- Disabled the autofill feature of the brush when using this tool to erase data. [#4729](https://github.com/scalableminds/webknossos/pull/4729)
- The rotation buttons of the 3D-viewport no longer change the zoom. [#4750](https://github.com/scalableminds/webknossos/pull/4750)
- Improved the performance of applying agglomerate files. [#4706](https://github.com/scalableminds/webknossos/pull/4706)
- In the Edit/Import Dataset form, the "Sharing" tab was renamed to "Sharing & Permissions". Also, existing permission-related settings were moved to that tab.  [#4683](https://github.com/scalableminds/webknossos/pull/4763)
- Improved rotation of camera in 3D viewport. [#4768](https://github.com/scalableminds/webknossos/pull/4768)
- Improved handling and communication of failures during download of data from datasets. [#4765](https://github.com/scalableminds/webknossos/pull/4765)
- The volume annotation tools in hybrid tracings are disabled while in merger mode. [#4757](https://github.com/scalableminds/webknossos/pull/4770)
- The title of a tab now shows the active tracing or dataset as well as the corresponding organization. [#4653](https://github.com/scalableminds/webknossos/pull/4767)

### Fixed
- Speed up NML import in existing tracings for NMLs with many trees (20,000+). [#4742](https://github.com/scalableminds/webknossos/pull/4742)
- Fixed tree groups when uploading NMLs with multi-component trees. [#4735](https://github.com/scalableminds/webknossos/pull/4735)
- Fixed that invalid number values in slider settings could crash webKnossos. [#4758](https://github.com/scalableminds/webknossos/pull/4758)

### Removed
-
