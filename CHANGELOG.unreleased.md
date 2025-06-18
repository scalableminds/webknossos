# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.06.2...HEAD)

### Added
- In shared annotations with multiple authors, some changes are now stored per user. This means that other users won’t see all those changes if their own diverge. This includes the current position and zoom, visibilities of trees, bounding boxes, and segments (as specified with the checkboxes in the lists), as well as which groups are expanded in the lists. The annotation owner’s user state is used as a fallback for users who haven’t explicitly changed these values themselves. [#8542](https://github.com/scalableminds/webknossos/pull/8542)
- Added the ability to duplicate trees in skeleton annotations. Users can create a copy of any tree (including all nodes, edges, and properties) via the context menu in the skeleton tab. [#8662](https://github.com/scalableminds/webknossos/pull/8662)
- Meshes are now reloaded using their previous opacity value. [#8622](https://github.com/scalableminds/webknossos/pull/8622)
- Authentication with Passkeys. [#8393](https://github.com/scalableminds/webknossos/pull/8393)

### Changed
- The datasource-properties.json as exposed in zarr streaming routes and volume annotation download now includes an explicit “path” attribute for every mag. The supplied path is relative to the location of the datasource-properties.json itself, e.g. `./color/2-2-1`. [#8518](https://github.com/scalableminds/webknossos/pull/8518)

### Fixed
- Improved efficiency of saving bounding box related changes. [#8492](https://github.com/scalableminds/webknossos/pull/8492)
- When deleting a dataset, its caches are cleared, so that if a new dataset by the same name is uploaded afterwards, only new data is loaded. [#8638](https://github.com/scalableminds/webknossos/pull/8638)
- Fixed the contrast of the WelcomeToast buttons. Updated `antd` to version `5.22`.[#8688](https://github.com/scalableminds/webknossos/pull/8688)
- Fixed a race condition when starting proofreading with a split action. [#8676](https://github.com/scalableminds/webknossos/pull/8676)
- Fixed that activating a mapping got stuck when a dataset was opened in "view" mode. [#8687](https://github.com/scalableminds/webknossos/pull/8687)
- Fixed a regression that led to incorrect behavior when trying to jump to the last branchpoint even though no branchpoint existed. [#8695](https://github.com/scalableminds/webknossos/pull/8695)

### Removed

### Breaking Changes
