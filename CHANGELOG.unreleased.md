# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.04.0...HEAD)

### Added
- Creating and deleting edges is now possible with ctrl+(alt/shift)+leftclick in orthogonal, flight and oblique mode. Also, the flight and oblique modes allow selecting nodes with leftclick, creating new trees with 'c' and deleting the active node with 'del'. [#7678](https://github.com/scalableminds/webknossos/pull/7678)

### Changed
- Improved task list to sort tasks by project date, add option to expand all tasks at once and improve styling. [#7709](https://github.com/scalableminds/webknossos/pull/7709)
- Changed the time-tracking overview to show times spent in annotations and tasks and filter them by teams and projects. In the linked detail view, the tracked times can also be filtered by type (annotations or tasks) and project. [#7524](https://github.com/scalableminds/webknossos/pull/7524)
- The time tracking api route `/api/users/:id/loggedTime`, which is used by the webknossos-libs client, and groups the times by month, now uses UTC when determining month limits, rather than the server’s local timezone. [#7524](https://github.com/scalableminds/webknossos/pull/7524)
- Duplicated annotations are opened in a new browser tab. [#7724](https://github.com/scalableminds/webknossos/pull/7724)
- Changed some internal APIs to use spelling dataset instead of dataSet. This requires all connected datastores to be the latest version. [#7690](https://github.com/scalableminds/webknossos/pull/7690)

### Fixed
- Fixed that the Command modifier on MacOS wasn't treated correctly for some shortcuts. Also, instead of the Alt key, the ⌥ key is shown as a hint in the status bar on MacOS. [#7659](https://github.com/scalableminds/webknossos/pull/7659)
- Moving from the time tracking overview to its detail view, the selected user was not preselected in the next view. [#7722](https://github.com/scalableminds/webknossos/pull/7722)
- Fixed incorrect position of WEBKNOSSOS logo in screenshots. [#7726](https://github.com/scalableminds/webknossos/pull/7726)

### Removed

### Breaking Changes
