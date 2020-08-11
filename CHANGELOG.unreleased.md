# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.07.0...HEAD)

### Added

- Added the possibility to select hour, minute and second of the time range in the timetracking view. [#4604](https://github.com/scalableminds/webknossos/pull/4604)
- Volume tracing data is now saved with lz4 compression, reducing I/O load and required disk space. [#4602](https://github.com/scalableminds/webknossos/pull/4602)
- Volume tracing data is now already lz4-compressed in the browser, further reducing server load. [#4623](https://github.com/scalableminds/webknossos/pull/4623)
- Isosurface generation now also supports volume tracings without fallback layer. [#4567](https://github.com/scalableminds/webknossos/pull/4567)
- Added the possibility to delete datasets on disk from webKnossos. Use with care. [#4696](https://github.com/scalableminds/webknossos/pull/4696)
- Added error toasts for failing bucket requests. [#4740](https://github.com/scalableminds/webknossos/pull/4740)

### Changed
- When d/f switching is turned off and a slice is copied with the shortcut `v`, the previous slice used as the source will always be slice - 1 and `shift + v` will always take slice + 1 as the slice to copy from. [#4728](https://github.com/scalableminds/webknossos/pull/4728)
- Disabled the autofill feature of the brush when using this tool to erase data. [#4729](https://github.com/scalableminds/webknossos/pull/4729)

### Fixed
- Speed up NML import in existing tracings for NMLs with many trees (20,000+). [#4742](https://github.com/scalableminds/webknossos/pull/4742)
- Fixed tree groups when uploading NMLs with multi-component trees. [#4735](https://github.com/scalableminds/webknossos/pull/4735)
- Fixed that invalid number values in slider settings could crash webKnossos. [#4758](https://github.com/scalableminds/webknossos/pull/4758)

### Removed
-
