# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.12.0...HEAD)

### Added
- Added the total volume of a dataset to a tooltip in the dataset info tab. [#8229](https://github.com/scalableminds/webknossos/pull/8229)

### Changed
- Renamed "resolution" to "magnification" in more places within the codebase, including local variables. [#8168](https://github.com/scalableminds/webknossos/pull/8168)
- Layer names are now allowed to contain `$` as special characters. [#8241](https://github.com/scalableminds/webknossos/pull/8241)
- Datasets can now be renamed and can have duplicate names. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- Improved the default colors for skeleton trees. [#8228](https://github.com/scalableminds/webknossos/pull/8228)
- Allowed to train an AI model using differently sized bounding boxes. We recommend all bounding boxes to have equal dimensions or to have dimensions which are multiples of the smallest bounding box. [#8222](https://github.com/scalableminds/webknossos/pull/8222)

### Fixed
- Fixed that listing datasets with the `api/datasets` route without compression failed due to missing permissions regarding public datasets. [#8249](https://github.com/scalableminds/webknossos/pull/8249)
- Fixed a bug that uploading a zarr dataset with an already existing `datasource-properties.json` file failed. [#8268](https://github.com/scalableminds/webknossos/pull/8268)
- Fixed that the frontend did not ensure a minium length for annotation layer names. Moreover, names starting with a `.` are also disallowed now. [#8244](https://github.com/scalableminds/webknossos/pull/8244)
- Fixed a bug where in the add remote dataset view the dataset name setting was not in sync with the datasource setting of the advanced tab making the form not submittable. [#8245](https://github.com/scalableminds/webknossos/pull/8245)
- Fix read and update dataset route for versions 8 and lower. [#8263](https://github.com/scalableminds/webknossos/pull/8263)
- Added missing legacy support for `isValidNewName` route. [#8252](https://github.com/scalableminds/webknossos/pull/8252)
- Fixed some layout issues in the upload view. [#8231](https://github.com/scalableminds/webknossos/pull/8231)
- Fixed `FATAL: role "postgres" does not exist` error message in Docker compose. [#8240](https://github.com/scalableminds/webknossos/pull/8240)

### Removed
- Removed support for HTTP API versions 3 and 4. [#8075](https://github.com/scalableminds/webknossos/pull/8075)

### Breaking Changes
