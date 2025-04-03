# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.03.0...HEAD)

### Added
- Added a credit system making payment for long running jobs possible. For now it is in testing phase. [#8352](https://github.com/scalableminds/webknossos/pull/8352)
- The maximum available storage of an organization is now enforced during upload. [#8385](https://github.com/scalableminds/webknossos/pull/8385)

### Changed

### Fixed
- Fixed visual alignment of actions in ai model list. [#8474](https://github.com/scalableminds/webknossos/pull/8474)
- Improve formatting of credits amount in organization management page [#8487](https://github.com/scalableminds/webknossos/pull/8487)
- Re-enabled jobs planned to be paid with credits for organizations without a paid plan. [#8478](https://github.com/scalableminds/webknossos/pull/8478)
- Fixed that the dataset extent tooltip in the right details bar in the dashboard did not properly update when switching datasets. [#8477](https://github.com/scalableminds/webknossos/pull/8477)
- Fixed a bug where task creation with volume zip as input would fail. [#8468](https://github.com/scalableminds/webknossos/pull/8468)
- Fixed a rare and subtle bug related to volume annotation and undo/redo. [#7506](https://github.com/scalableminds/webknossos/pull/7506)
- Fixed that a warning message about a newer version of an annotation was shown multiple times. [#8486](https://github.com/scalableminds/webknossos/pull/8486)

### Removed

### Breaking Changes
