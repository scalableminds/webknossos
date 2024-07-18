# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.07.0...HEAD)

### Added
- WEBKNOSSOS now automatically searches in subfolder / sub-collection identifiers for valid datasets in case a provided link to a remote dataset does not directly point to a dataset. [#7912](https://github.com/scalableminds/webknossos/pull/7912)
- Added the option to move a bounding box via dragging while pressing ctrl / meta. [#7892](https://github.com/scalableminds/webknossos/pull/7892)
- Added route `/import?url=<url_to_datasource>` to automatically import and view remote datasets. [#7844](https://github.com/scalableminds/webknossos/pull/7844)
- The context menu that is opened upon right-clicking a segment in the dataview port now contains the segment's name. [#7920](https://github.com/scalableminds/webknossos/pull/7920) 

### Changed
- The warning about a mismatch between the scale of a pre-computed mesh and the dataset scale's factor now also considers all supported mags of the active segmentation layer. This reduces the false posive rate regarding this warning. [#7921](https://github.com/scalableminds/webknossos/pull/7921/)

### Fixed
- Fixed a bug that allowed the default newly created bounding box to appear outside the dataset. In case the whole bounding box would be outside it is created regardless. [#7892](https://github.com/scalableminds/webknossos/pull/7892)
- Fixed a rare bug that could cause hanging dataset uploads. [#7932](https://github.com/scalableminds/webknossos/pull/7932)

### Removed

### Breaking Changes
