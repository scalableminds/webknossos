# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.06.0...HEAD)

### Added
- Added the option to lock an explorative anntations for the owner. Locked annotation cannot be annotated by any user. [#7801](https://github.com/scalableminds/webknossos/pull/7801)
- Uploading an annotation into a dataset that it was not created for now also works if the dataset is in a different organization. [#7816](https://github.com/scalableminds/webknossos/pull/7816)
- When downloading + reuploading an annotation that is based on a segmentation layer with active mapping, that mapping is now still be selected after the reupload. [#7822](https://github.com/scalableminds/webknossos/pull/7822)

### Changed

### Fixed

### Removed

### Breaking Changes
