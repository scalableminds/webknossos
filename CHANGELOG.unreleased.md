# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.04.0...HEAD)

### Added

### Changed
- Improved task list to sort tasks by project date, add option to expand all tasks at once and improve styling. [#7709](https://github.com/scalableminds/webknossos/pull/7709)
- Changed the time-tracking overview to show times spent in annotations and tasks and filter them by teams and projects. In the linked detail view, the tracked times can also be filtered by type (annotations or tasks) and project. [#7524](https://github.com/scalableminds/webknossos/pull/7524)
- The time tracking api route `/api/users/:id/loggedTime`, which is used by the webknossos-libs client, and groups the times by month, now uses UTC when determining month limits, rather than the server’s local timezone. [#7524](https://github.com/scalableminds/webknossos/pull/7524)

### Fixed
- Moving from the time tracking overview to its detail view, the selected user was not preselected in the next view. [#7722](https://github.com/scalableminds/webknossos/pull/7722)

### Removed

### Breaking Changes
