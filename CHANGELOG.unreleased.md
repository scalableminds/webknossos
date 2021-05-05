# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.05.0...HEAD)

### Added
- Added a dark theme for webKnossos. [#5407](https://github.com/scalableminds/webknossos/pull/5407)

### Changed
- The deployment configuration of webKnossos was cleaned up. If you host your own webKnossos instance, be sure to update your config according to the migration guide. [#5208](https://github.com/scalableminds/webknossos/pull/5208)

### Fixed
- Fixed a bug where users could see long-running jobs listing of other users [#5435](https://github.com/scalableminds/webknossos/pull/5435)
- Fixed a rendering bug which occurred when the initial layout had a hidden 3D viewport. [#5429](https://github.com/scalableminds/webknossos/pull/5429)
- Fixed an incorrect initial camera rotation in the 3D viewport and an incorrect initial zoom value. [#5453](https://github.com/scalableminds/webknossos/pull/5453)
- Fixed a bug where the task search showed duplicates if a user had multiple instances of a task (as made possible by the transfer functionality). [#5456](https://github.com/scalableminds/webknossos/pull/5456)
- Fixed a bug where showing active users of a project, and transferring their tasks was broken. [#5456](https://github.com/scalableminds/webknossos/pull/5456)

### Removed
-

### Breaking Change
-
