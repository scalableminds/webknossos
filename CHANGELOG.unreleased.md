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

### Changed
- When d/f switching is turned off and a slice is copied with the shortcut `v`, the previous slice used as the source will always be slice - 1 and `shift + v` will always take slice + 1 as the slice to copy from. [#4728](https://github.com/scalableminds/webknossos/pull/4728)
- Disabled the autofill feature of the brush when using this tool to erase data. [#4729](https://github.com/scalableminds/webknossos/pull/4729)
- The rotation buttons of the 3D-viewport no longer change the zoom. [#4750](https://github.com/scalableminds/webknossos/pull/4750)
- Improved the performance of applying agglomerate files. [#4706](https://github.com/scalableminds/webknossos/pull/4706)
- Moved a dataset's permission settings to the sharing tab. [#4683](https://github.com/scalableminds/webknossos/pull/4763)

### Fixed
- Speed up NML import in existing tracings for NMLs with many trees (20,000+). [#4742](https://github.com/scalableminds/webknossos/pull/4742)
- Fixed tree groups when uploading NMLs with multi-component trees. [#4735](https://github.com/scalableminds/webknossos/pull/4735)
- Fixed that invalid number values in slider settings could crash webKnossos. [#4758](https://github.com/scalableminds/webknossos/pull/4758)

### Removed
-
