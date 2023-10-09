# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.1...HEAD)

### Added

- Added social media link previews for links to datasets and annotations (only if they are public or if the links contain sharing tokens). [#7331](https://github.com/scalableminds/webknossos/pull/7331)
- Loading sharded zarr3 datasets is now significantly faster. [#7363](https://github.com/scalableminds/webknossos/pull/7363)
- OME-NGFF datasets with only 2 dimensions can now be imported and viewed. [#7349](https://github.com/scalableminds/webknossos/pull/7349)

### Changed
- Updated backend code to Scala 2.13, with upgraded Dependencies for optimized performance. [#7327](https://github.com/scalableminds/webknossos/pull/7327)

### Fixed
- Fixed that segment statistics were requested in the wrong resolution and without properly considering the dataset scale. [#7355](https://github.com/scalableminds/webknossos/pull/7355)
- Fixed that some segment (group) actions were not properly disabled for non-editable segmentation layers. [#7207](https://github.com/scalableminds/webknossos/issues/7207)

### Removed

### Breaking Changes
