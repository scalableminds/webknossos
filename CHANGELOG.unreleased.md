# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.02.0...HEAD)

### Added
- Viewport scale bars are now dynamically adjusted to display sensible values. [#5418](https://github.com/scalableminds/webknossos/pull/6034)
- Added the option to make a segment's ID active via the right-click context menu in the segments list. [#5935](https://github.com/scalableminds/webknossos/pull/6006)
- Added a button next to the histogram which adapts the contrast and brightness to the currently visible data. [#5961](https://github.com/scalableminds/webknossos/pull/5961)
- Running uploads can now be cancelled. [#5958](https://github.com/scalableminds/webknossos/pull/5958)
- Added experimental min-cut feature to split a segment in a volume tracing with two seeds. [#5885](https://github.com/scalableminds/webknossos/pull/5885)
- Annotations with multiple volume layers can now be uploaded. (Note that merging multiple annotations with multiple volume layers each is not supported.) [#6028](https://github.com/scalableminds/webknossos/pull/6028)
- Decrease volume annotation download latency by using a different compression level. [#6036](https://github.com/scalableminds/webknossos/pull/6036)
- The visible meshes are now included in the link copied from the "Share" modal or the "Share" button next to the dataset position. They are automatically loaded for users that open the shared link. [#5993](https://github.com/scalableminds/webknossos/pull/5993)
- Added a new "Connectome Tab" which can be used to explore connectomes by visualizing neurites and their synaptic connections. Connectome files need to be placed in a `connectomes` folder inside of the respective segmentation layer. It is possible to craft links that automatically load specific agglomerates and their synapses when openend. For more information refer to https://docs.webknossos.org/webknossos/sharing.html#sharing-link-format. [#5894](https://github.com/scalableminds/webknossos/pull/5894)

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

### Fixed
- Fixed volume-related bugs which could corrupt the volume data in certain scenarios. [#5955](https://github.com/scalableminds/webknossos/pull/5955)
- Fixed the placeholder resolution computation for anisotropic layers with missing base resolutions. [#5983](https://github.com/scalableminds/webknossos/pull/5983)
- Fixed a bug where ad-hoc meshes were computed for a mapping, although it was disabled. [#5982](https://github.com/scalableminds/webknossos/pull/5982)
- Fixed a bug where volume annotation downloads would sometimes contain truncated zips. [#6009](https://github.com/scalableminds/webknossos/pull/6009)
- Fixed a bug where downloaded multi-layer volume annotations would have the wrong data.zip filenames. [#6028](https://github.com/scalableminds/webknossos/pull/6028)
- Fixed a bug which could cause an error message to appear when saving. [#6052](https://github.com/scalableminds/webknossos/pull/6052)
- Fixed a bug where deactivated users would still be listed as allowed to access the datasets of their team. [#6070](https://github.com/scalableminds/webknossos/pull/6070)

### Removed

### Breaking Changes
