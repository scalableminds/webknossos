# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.05.0...HEAD)

### Added

-

### Changed

- Improved logging in case of very slow annotation saving. Additionally, the user is also warned when there are unsaved changes older than two minutes. [#4593](https://github.com/scalableminds/webknossos/pull/4593)
- REST API for creating / changing datastores now contains additional field `allowsUpload` denoting if the datastore allows uploading datasets via browser.

### Fixed

- When activating an agglomerate file-based ID mapping, only the segmentation layer will be reloaded from now on. This will improve mapping activation performance. [#4600](https://github.com/scalableminds/webknossos/pull/4600)
- Fixed retrying of failed save requests sent during tracingstore restart. [#4591](https://github.com/scalableminds/webknossos/pull/4591)

### Removed

-

