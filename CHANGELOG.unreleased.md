# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.12.0...HEAD)

### Added
- Added sign in via OIDC. [#6534](https://github.com/scalableminds/webknossos/pull/6534)
- Added a new datasets tab to the dashboard which supports managing datasets in folders. Folders can be organized hierarchically and datasets can be moved into these folders. Selecting a dataset will show dataset details in a sidebar. [#6591](https://github.com/scalableminds/webknossos/pull/6591)
- Added the option to search a specific folder in the new datasets tab. [#6677](https://github.com/scalableminds/webknossos/pull/6677)

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
- Redesigned organization page to include more infos on organization users, storage, webKnossos plan and provided opportunities to upgrade. [#6602](https://github.com/scalableminds/webknossos/pull/6602)

### Fixed
- Fixed import of N5 datasets. [#6668](https://github.com/scalableminds/webknossos/pull/6668)
- Fixed a bug where it was possible to create invalid an state by deleting teams that are referenced elsewhere. [6664](https://github.com/scalableminds/webknossos/pull/6664)
- Miscellaneous fixes for the new folder UI. [#6674](https://github.com/scalableminds/webknossos/pull/6674)
- Fixed import of remote datasets with multiple layers and differing resolution pyramid. #[6670](https://github.com/scalableminds/webknossos/pull/6670)
- Fixed broken Get-new-Task button in task dashboard. [#6677](https://github.com/scalableminds/webknossos/pull/6677)
- Fixed access of remote datasets using the Amazon S3 protocol [#6679](https://github.com/scalableminds/webknossos/pull/6679)
- Fixed a bug in line measurement that would lead to an infinite loop. [#6689](https://github.com/scalableminds/webknossos/pull/6689)
- Fixed a bug where malformed json files could lead to uncaught exceptions.[#6691](https://github.com/scalableminds/webknossos/pull/6691)

### Removed

### Breaking Changes
