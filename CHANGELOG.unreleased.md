# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.07.0...HEAD)

### Added
- Added a warning for invalid volume layer names. The layer names must now be unique among all layers in an annotation and must not contain url encoded special characters. [#6289](https://github.com/scalableminds/webknossos/pull/6289)
- Added optional mappingName parameter to `requestRawCuboid` datastore route, which allows to directly apply a specified mapping in the backend. [#6311](https://github.com/scalableminds/webknossos/pull/6311)
- Added option to use `X-Auth-Token` header instead of query parameter in every datastore and tracingstore route. [#6312](https://github.com/scalableminds/webknossos/pull/6312)
- Add new backend API routes for working with annotations without having to provide a 'type' argument. Note that these support stored annotations (Task and Explorational), but do not work for CompoundTask/CompoundProject/CompoundTaskType annotations. For the latter, please use the original route variants with explicit type. [#6285](https://github.com/scalableminds/webknossos/pull/6285)

### Changed
- Changed the name of the volume annotation layer in tasks to be "Volume" instead of "Volume Layer". [#6321](https://github.com/scalableminds/webknossos/pull/6321)

### Fixed
- Fixed that zooming out for datasets with very large scale was not possible until the coarsest level. [#6304](https://github.com/scalableminds/webknossos/pull/6304)

### Removed

### Breaking Changes
