# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.01.0...HEAD)

### Added

### Changed
- The log viewer in the Voxelytics workflow reporting now uses a virtualized list. [#6579](https://github.com/scalableminds/webknossos/pull/6579)
- Node positions are always handled as integers. They have always been persisted as integers by the server, anyway, but the session in which a node was created handled the position as floating point in earlier versions. [#6589](https://github.com/scalableminds/webknossos/pull/6589)
- Jobs can no longer be started on datastores without workers. [#6595](https://github.com/scalableminds/webknossos/pull/6595)
- When downloading volume annotations with volume data skipped, the nml volume tag is now included anyway (but has no location attribute in this case). [#6566](https://github.com/scalableminds/webknossos/pull/6566)
- Re-phrased some backend (error) messages to improve clarity and provide helping hints. [#6616](https://github.com/scalableminds/webknossos/pull/6616)
- The layer visibility is now encoded in the sharing link. The user opening the link will see the same layers that were visible when copying the link. [#6634](https://github.com/scalableminds/webknossos/pull/6634)
- Voxelytics workflows can now be viewed by anyone with the link who is in the right organization. [#6622](https://github.com/scalableminds/webknossos/pull/6622)
- webKnossos is now able to recover from a lost webGL context. [#6663](https://github.com/scalableminds/webknossos/pull/6663)
- Bulk task creation now needs the taskTypeId, the task type summary will no longer be accepted. [#6640](https://github.com/scalableminds/webknossos/pull/6640)
- Error handling and reporting is more robust now. [#6700](https://github.com/scalableminds/webknossos/pull/6700)
- The Quick-Select settings are opened (and closed) automatically when labeling with the preview mode. That way, bulk labelings with preview mode don't require constantly opening the settings manually. [#6706](https://github.com/scalableminds/webknossos/pull/6706)
- Improved performance of opening a dataset or annotation. [#6711](https://github.com/scalableminds/webknossos/pull/6711)
- Redesigned organization page to include more infos on organization users, storage, webKnossos plan and provided opportunities to upgrade. [#6602](https://github.com/scalableminds/webknossos/pull/6602)

### Fixed
- Fixed the validation of some neuroglancer URLs during import. [#6722](https://github.com/scalableminds/webknossos/pull/6722)

### Removed

### Breaking Changes
