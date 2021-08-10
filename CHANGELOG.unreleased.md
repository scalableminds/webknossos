# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.07.0...HEAD)

### Added
- Fixed a bug where non-existing resolutions could be selected for wk-worker-based meshfile computations [#5631](https://github.com/scalableminds/webknossos/pull/5631)
- Added new mesh-related functions to the front-end API: getAvailableMeshFiles, getActiveMeshFile, setActiveMeshFile, loadPrecomputedMesh, computeMeshOnDemand, setMeshVisibility, removeMesh. [#5634](https://github.com/scalableminds/webknossos/pull/5634)
- Added a route to call new webknossos-worker job for nuclei inferral. [#5626](https://github.com/scalableminds/webknossos/pull/5626)

### Changed
- Improved context menu for interactions with segmentation data which wasn't loaded completely, yet. [#5637](https://github.com/scalableminds/webknossos/pull/5637)
- Clicking outside of the context menu closes it without performing any other action (e.g., previously, a node could be created when clicking outside of the context menu, when the skeleton tool was active). Also, a repeated rightclick doesn't open the context menu again. [#5658](https://github.com/scalableminds/webknossos/pull/5658)

### Fixed
- Fix that active segment and node id were not shown in status bar when being in a non-hybrid annotation. [#5638](https://github.com/scalableminds/webknossos/pull/5638)
- Fix that "Compute Mesh File" button was enabled in scenarios where it should not be supported (e.g., when no segmentation layer exists). [#5648](https://github.com/scalableminds/webknossos/pull/5648)
- Fixed a bug where an authentication error was shown when viewing the meshes tab while not logged in. [#5647](https://github.com/scalableminds/webknossos/pull/5647)
- Fixed that the copy buttons in the context menu did not work properly. [#5658](https://github.com/scalableminds/webknossos/pull/5658)
- Fixed that undoing of volume annotations might overwrite the backend data on not loaded magnifications with nothing. [#5608](https://github.com/scalableminds/webknossos/pull/5608)
- Fixed a bug where volume annotation downloads were occasionally cancelled with “Connection reset by peer” error. [#5660](https://github.com/scalableminds/webknossos/pull/5660)

### Removed
-

### Breaking Change
- The interface of the cross-origin API changed. The initialization message is no longer an object with a `message` property of "api ready", but instead an object with a `type` property of "init". Additionally, if an API call finishes, a return message of type "ack" is sent. If the original API call contained a `messageId` property, the return message will contain the same `messageId` to allow to match the return message. If the API call is misformatted, a return message of `type` "err" is sent, containing an error message in the `message` property.
