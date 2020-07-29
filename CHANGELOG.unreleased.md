# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.07.0...HEAD)

### Added
- Added the possibility to delete datasets on disk from webKnossos. Use with care. [#4696]()(https://github.com/scalableminds/webknossos/pull/4696)

### Changed
- When d/f switching is turned off and a slice is copied with the shortcut `v`, the previous slice used as the source will always be slice - 1 and `shift + v` will always take slice + 1 as the slice to copy from. [#4728](https://github.com/scalableminds/webknossos/pull/4728)
- Disabled the autofill feature of the brush when using this tool to erase data. [#4729](https://github.com/scalableminds/webknossos/pull/4729)

### Fixed
- 

### Removed
-
