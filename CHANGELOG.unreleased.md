# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.05.0...HEAD)

### Added
- Within the proofreading tool, the user can now interact with the super voxels of a mesh in the 3D viewport. For example, this allows to merge or cut super voxels from another. As before, the proofreading tool requires an agglomerate file. [#7742](https://github.com/scalableminds/webknossos/pull/7742)
- Minor improvements for the timetracking overview (faster data loading, styling). [#7789](https://github.com/scalableminds/webknossos/pull/7789)
- Updated several backend dependencies for optimized stability and performance. [#7782](https://github.com/scalableminds/webknossos/pull/7782)
- Voxelytics workflows can be searched by name and hash. [#7790](https://github.com/scalableminds/webknossos/pull/7790)

### Changed
- Non-admin or -manager users can no longer start long-running jobs that create datasets. This includes annotation materialization and AI inferrals. [#7753](https://github.com/scalableminds/webknossos/pull/7753)
- In the time tracking view, all annotations and tasks can be shown for each user by expanding the table. The individual time spans spent with a task or annotating an explorative annotation can be accessed via CSV export. The detail view including a chart for the individual spans has been removed. [#7733](https://github.com/scalableminds/webknossos/pull/7733)
- Slightly refactored the `<FixExpandleTable/>`component to use columns as props. [#7772](https://github.com/scalableminds/webknossos/pull/7772)
- The config value `datastore.localFolderWhitelist` can now be set for each datastore individually. [#7800](https://github.com/scalableminds/webknossos/pull/7800)

### Fixed
- Fixed a bug where a toast that was reopened had a flickering effect during the reopening animation. [#7793](https://github.com/scalableminds/webknossos/pull/7793)
- Fixed a bug where some annotation times would be shown double. [#7787](https://github.com/scalableminds/webknossos/pull/7787)
- Fixed a bug where no columns were shown in the time tracking overview. [#7803](https://github.com/scalableminds/webknossos/pull/7803)
- Fixed a bug where ad-hoc meshes for coarse magnifications would have gaps. [#7799](https://github.com/scalableminds/webknossos/pull/7799)

### Removed

### Breaking Changes
