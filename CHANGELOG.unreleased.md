# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.11.1...HEAD)

### Added
- When exploring remote URIs pasted from Neuroglancer, the format prefixes like `precomputed://` are now ignored, so users don’t have to remove them. [#8195](https://github.com/scalableminds/webknossos/pull/8195)
- Added the possibility to configure a rotation for a dataset which can be toggled off and on when viewing and annotating data. [#8159](https://github.com/scalableminds/webknossos/pull/8159)
- Added the total volume of a dataset to a tooltip in the dataset info tab. [#8229](https://github.com/scalableminds/webknossos/pull/8229)

### Changed
- Renamed "resolution" to "magnification" in more places within the codebase, including local variables. [#8168](https://github.com/scalableminds/webknossos/pull/8168)
- Reading image files on datastore filesystem is now done asynchronously. [#8126](https://github.com/scalableminds/webknossos/pull/8126)
- Datasets can now be renamed and can have duplicate names. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- Improved error messages for starting jobs on datasets from other organizations. [#8181](https://github.com/scalableminds/webknossos/pull/8181)
- Terms of Service for Webknossos are now accepted at registration, not afterward. [#8193](https://github.com/scalableminds/webknossos/pull/8193)
- Removed bounding box size restriction for inferral jobs for super users. [#8200](https://github.com/scalableminds/webknossos/pull/8200)
- Improved the default colors for skeleton trees. [#8228](https://github.com/scalableminds/webknossos/pull/8228)
- Improved logging for errors when loading datasets and problems arise during a conversion step. [#8202](https://github.com/scalableminds/webknossos/pull/8202)
- Allowed to train an AI model using differently sized bounding boxes. We recommend all bounding boxes to have equal dimensions or to have dimensions which are multiples of the smallest bounding box. [#8222](https://github.com/scalableminds/webknossos/pull/8222)

### Fixed
- Fixed performance bottleneck when deleting a lot of trees at once. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fixed that listing datasets with the `api/datasets` route without compression failed due to missing permissions regarding public datasets. [#8249](https://github.com/scalableminds/webknossos/pull/8249)
- Fixed that the frontend did not ensure a minium length for annotation layer names. Moreover, names starting with a `.` are also disallowed now. [#8244](https://github.com/scalableminds/webknossos/pull/8244)
- Fixed a bug where changing the color of a segment via the menu in the segments tab would update the segment color of the previous segment, on which the context menu was opened. [#8225](https://github.com/scalableminds/webknossos/pull/8225)
- Fixed a bug where in the add remote dataset view the dataset name setting was not in sync with the datasource setting of the advanced tab making the form not submittable. [#8245](https://github.com/scalableminds/webknossos/pull/8245)
- Fixed a bug when importing an NML with groups when only groups but no trees exist in an annotation. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fix read and update dataset route for versions 8 and lower. [#8263](https://github.com/scalableminds/webknossos/pull/8263)
- Added missing legacy support for `isValidNewName` route. [#8252](https://github.com/scalableminds/webknossos/pull/8252)
- Fixed a bug where trying to delete a non-existing node (via the API, for example) would delete the whole active tree. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fixed a bug where dataset uploads would fail if the organization directory on disk is missing. [#8230](https://github.com/scalableminds/webknossos/pull/8230)
- Fixed some layout issues in the upload view. [#8231](https://github.com/scalableminds/webknossos/pull/8231)
- Fixed `FATAL: role "postgres" does not exist` error message in Docker compose. [#8240](https://github.com/scalableminds/webknossos/pull/8240)

### Removed
- Removed support for HTTP API versions 3 and 4. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- Removed Google Analytics integration. [#8201](https://github.com/scalableminds/webknossos/pull/8201)

### Breaking Changes
