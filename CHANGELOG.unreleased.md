# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.02.0...HEAD)

### Added
- Added the option to make a segment's ID active via the right-click context menu in the segments list. [#5935](https://github.com/scalableminds/webknossos/pull/6006)
- Added a button next to the histogram which adapts the contrast and brightness to the currently visible data. [#5961](https://github.com/scalableminds/webknossos/pull/5961)
- Running uploads can now be cancelled. [#5958](https://github.com/scalableminds/webknossos/pull/5958)
- Annotations with multiple volume layers can now be uploaded. (Note that merging multiple annotations with multiple volume layers each is not supported.) [#6028](https://github.com/scalableminds/webknossos/pull/6028)

### Changed
- Upgraded webpack build tool to v5 and all other webpack related dependencies to their latest version. Enabled persistent caching which speeds up server restarts during development as well as production builds. [#5969](https://github.com/scalableminds/webknossos/pull/5969)
- Improved stability when quickly volume-annotating large structures. [#6000](https://github.com/scalableminds/webknossos/pull/6000)
- The front-end API `labelVoxels` returns a promise now which fulfills as soon as the label operation was carried out. [#5955](https://github.com/scalableminds/webknossos/pull/5955)
- When changing which layers are visible in an annotation, this setting is persisted in the annotation, so when you share it, viewers will see the same visibility configuration. [#5967](https://github.com/scalableminds/webknossos/pull/5967)
- Downloading public annotations is now also allowed without being authenticated. [#6001](https://github.com/scalableminds/webknossos/pull/6001)
- Downloaded volume annotation layers no longer produce zero-byte zipfiles but rather a valid header-only zip file with no contents. [#6022](https://github.com/scalableminds/webknossos/pull/6022)
- Changed a number of API routes from GET to POST to avoid unwanted side effects. [#6023](https://github.com/scalableminds/webknossos/pull/6023)
- Removed unused datastore route `checkInbox` (use `checkInboxBlocking` instead). [#6023](https://github.com/scalableminds/webknossos/pull/6023)

### Fixed
- Fixed volume-related bugs which could corrupt the volume data in certain scenarios. [#5955](https://github.com/scalableminds/webknossos/pull/5955)
- Fixed the placeholder resolution computation for anisotropic layers with missing base resolutions. [#5983](https://github.com/scalableminds/webknossos/pull/5983)
- Fixed a bug where ad-hoc meshes were computed for a mapping, although it was disabled. [#5982](https://github.com/scalableminds/webknossos/pull/5982)
- Fixed a bug where volume annotation downloads would sometimes contain truncated zips. [#6009](https://github.com/scalableminds/webknossos/pull/6009)
- Fixed a bug where downloaded multi-layer volume annotations would have the wrong data.zip filenames. [#6028](https://github.com/scalableminds/webknossos/pull/6028)


### Removed

### Breaking Changes
