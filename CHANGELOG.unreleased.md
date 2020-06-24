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
- The brush size minimum was changed from 5 voxels to 1. [#4648](https://github.com/scalableminds/webknossos/pull/4648)
- Separated the permissions of Team Managers (now actually team-scoped) and Dataset Managers (who can see all datasets). The database evolution makes all Team Managers also Dataset Managers, so no workflows should be interrupted. New users may have to be made Dataset Managers, though. For more information, refer to the updated documentation. [#4663](https://github.com/scalableminds/webknossos/pull/4663)
- Refined all webKnossos emails for user signups etc. Switched emails to use HTML templates for more bling bling [#4676](https://github.com/scalableminds/webknossos/pull/4676)

### Fixed

- Fixed that the dataset list in the dashboard could reorder its items asynchronously which could be very annoying for the user. [#4640](https://github.com/scalableminds/webknossos/pull/4640)
- Improved resilience when refreshing datasets while a datastore is down. [#4636](https://github.com/scalableminds/webknossos/pull/4636)
- Fixed a bug where requesting volume tracing fallback layer data from webknossos-connect failed. [#4644](https://github.com/scalableminds/webknossos/pull/4644)
- Fixed a bug where imported invisible trees were still visible. [#4659](https://github.com/scalableminds/webknossos/issues/4659)
- Fixed the message formatting for standalone datastores and tracingstores. [#4656](https://github.com/scalableminds/webknossos/pull/4656)
- Fixed that merger mode didn't work with undo and redo. Also fixed that the mapping was not disabled when disabling merger mode. [#4669](https://github.com/scalableminds/webknossos/pull/4669)

### Removed

-
