# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.12.0...HEAD)

### Added
- Added a new datasets tab to the dashboard which supports managing datasets in folders. Folders can be organized hierarchically and datasets can be moved into these folders. Selecting a dataset will show dataset details in a sidebar. [#6591](https://github.com/scalableminds/webknossos/pull/6591)

### Changed
- webKnossos is now able to recover from a lost webGL context. [#6663](https://github.com/scalableminds/webknossos/pull/6663)
- Bulk task creation now needs the taskTypeId, the task type summary will no longer be accepted. [#6640](https://github.com/scalableminds/webknossos/pull/6640)

### Fixed
- Fixed import of N5 datasets. [#6668](https://github.com/scalableminds/webknossos/pull/6668)
- Fixed a bug where it was possible to create invalid an state by deleting teams that are referenced elsewhere. [6664](https://github.com/scalableminds/webknossos/pull/6664)

### Removed

### Breaking Changes
