# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.06.0...HEAD)

### Added

- Added a warning to the segmentation tab when viewing `uint64` bit segmentation data. [#4598](https://github.com/scalableminds/webknossos/pull/4598)

### Changed

- The redundant “team” column was removed from the bulk task creation format. [#4629](https://github.com/scalableminds/webknossos/pull/4629)

### Fixed

- Fixed that the dataset list in the dashboard could reorder its items asynchronously which could be very annoying for the user. [#4640](https://github.com/scalableminds/webknossos/pull/4640)
- Improved resilience when refreshing datasets while a datastore is down. [#4636](https://github.com/scalableminds/webknossos/pull/4636)
- Fixed a bug where requesting volume tracing fallback layer data from webknossos-connect failed. [#4644](https://github.com/scalableminds/webknossos/pull/4644)
- Fixed the message formatting for standalone datastores and tracingstores. [#4656](https://github.com/scalableminds/webknossos/pull/4656)

### Removed

-

