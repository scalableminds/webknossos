# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/release-YY.MM...HEAD)

### Added
- The visible meshes are now included in the link copied from the "Share" modal or the "Share" button next to the dataset position. They are automatically loaded for users that open the shared link. [#5993](https://github.com/scalableminds/webknossos/pull/5993)

### Changed
- Upgraded webpack build tool to v5 and all other webpack related dependencies to their latest version. Enabled persistent caching which speeds up server restarts during development as well as production builds. [#5969](https://github.com/scalableminds/webknossos/pull/5969)
- Improved stability when quickly volume-annotating large structures. [#6000](https://github.com/scalableminds/webknossos/pull/6000)
- The front-end API `labelVoxels` returns a promise now which fulfills as soon as the label operation was carried out. [#5955](https://github.com/scalableminds/webknossos/pull/5955)
- Changed that webKnossos no longer tries to reach a save state where all updates are sent to the backend to be in sync with the frontend when the save is triggered by a timeout. [#5999](https://github.com/scalableminds/webknossos/pull/5999)
- When changing which layers are visible in an annotation, this setting is persisted in the annotation, so when you share it, viewers will see the same visibility configuration. [#5967](https://github.com/scalableminds/webknossos/pull/5967)
- Downloading public annotations is now also allowed without being authenticated. [#6001](https://github.com/scalableminds/webknossos/pull/6001)
- Downloaded volume annotation layers no longer produce zero-byte zipfiles but rather a valid header-only zip file with no contents. [#6022](https://github.com/scalableminds/webknossos/pull/6022)
- Changed a number of API routes from GET to POST to avoid unwanted side effects. [#6023](https://github.com/scalableminds/webknossos/pull/6023)
- Removed unused datastore route `checkInbox` (use `checkInboxBlocking` instead). [#6023](https://github.com/scalableminds/webknossos/pull/6023)
- Migrated to Google Analytics 4. [#6031](https://github.com/scalableminds/webknossos/pull/6031)
- The maximum brush size now depends on the available magnifications. Consequentially, one can use a larger brush size when the magnifications of a volume layer are restricted. [#6066](https://github.com/scalableminds/webknossos/pull/6066)

### Fixed
- Fixed a bug where deactivated users would still be listed as allowed to access the datasets of their team. [#6070](https://github.com/scalableminds/webknossos/pull/6070)

### Removed

### Breaking Changes
