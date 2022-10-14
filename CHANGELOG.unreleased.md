# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.10.0...HEAD)

### Added
- Support for a new mesh file format which allows up to billions of meshes. [#6491](https://github.com/scalableminds/webknossos/pull/6491)
- Remote n5 datasets can now also be explored and added. [#6520](https://github.com/scalableminds/webknossos/pull/6520)
- Improved performance for applying agglomerate mappings on segmentation data. [#6532](https://github.com/scalableminds/webknossos/pull/6532)

### Changed
- Creating tasks in bulk now also supports referencing task types by their summary instead of id. [#6486](https://github.com/scalableminds/webknossos/pull/6486)

### Fixed
- Fixed a bug where some file requests replied with error 400 instead of 404, confusing some zarr clients. [#6515](https://github.com/scalableminds/webknossos/pull/6515)
- Fixed a bug where the `transform` of a new mesh file wasn't taken into account for the rendering of meshes. [#6552](https://github.com/scalableminds/webknossos/pull/6552) 

### Removed

### Breaking Changes
