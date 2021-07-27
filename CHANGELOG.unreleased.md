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

### Fixed
-

### Removed
-

### Breaking Change
- The interface of the cross-origin API changed. The initialization message is no longer an object with a `message` property of "api ready", but instead an object with a `type` property of "init". Additionally, if an API call finishes, a return message of type "ack" is sent. If the original API call contained a `messageId` property, the return message will contain the same `messageId` to allow to match the return message. If the API call is misformatted, a return message of `type` "err" is sent, containing an error message in the `message` property.
