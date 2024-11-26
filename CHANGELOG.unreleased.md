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

### Changed
- Reading image files on datastore filesystem is now done asynchronously. [#8126](https://github.com/scalableminds/webknossos/pull/8126)
- Improved error messages for starting jobs on datasets from other organizations. [#8181](https://github.com/scalableminds/webknossos/pull/8181)
- Removed bounding box size restriction for inferral jobs for super users. [#8200](https://github.com/scalableminds/webknossos/pull/8200)

### Fixed
- Fixed performance bottleneck when deleting a lot of trees at once. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fixed a bug where changing the color of a segment via the menu in the segments tab would update the segment color of the previous segment, on which the context menu was opened. [#8225](https://github.com/scalableminds/webknossos/pull/8225)
- Fixed a bug when importing an NML with groups when only groups but no trees exist in an annotation. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fixed a bug where trying to delete a non-existing node (via the API, for example) would delete the whole active tree. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fixed some layout issues in the upload view. [#8231](https://github.com/scalableminds/webknossos/pull/8231)

### Removed
- Removed Google Analytics integration. [#8201](https://github.com/scalableminds/webknossos/pull/8201)

### Breaking Changes
