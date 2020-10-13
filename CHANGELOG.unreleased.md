# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.10.0...HEAD)

### Added
- Hybrid tracings can now be imported directly in the tracing view via drag'n'drop. [#4837](https://github.com/scalableminds/webknossos/pull/4837)
- The find data function now works for volume tracings, too. [#4847](https://github.com/scalableminds/webknossos/pull/4847)
- Added admins and dataset managers to dataset access list, as they can access all datasets of the organization. [#4862](https://github.com/scalableminds/webknossos/pull/4862)

### Changed
- Brush circles are now connected with rectangles to provide a continuous stroke even if the brush is moved quickly. [#4785](https://github.com/scalableminds/webknossos/pull/4822)
- The position input of tracings now accepts decimal input. When losing focus the values are cut off at the comma. [#4803](https://github.com/scalableminds/webknossos/pull/4803)
- webknossos.org only: Accounts associated with new organizations can now be created even when a datastore is unreachable. The necessary folders are created lazily when needed. [#4846](https://github.com/scalableminds/webknossos/pull/4846)
- When downloading a volume tracing, buckets containing a single 0 byte, that were created to restore older versions, are now skipped. [#4851](https://github.com/scalableminds/webknossos/pull/4851)
- Task information CSV now contains additional column `creationInfo`, containing the original NML filename for tasks based on existing NMLs. [#4866](https://github.com/scalableminds/webknossos/pull/4866)

### Fixed
- Fixed failing histogram requests for float layers with NaN values. [#4834](https://github.com/scalableminds/webknossos/pull/4834)
- Fixed the disappearing of dataset settings after switching between view mode and annotation mode. [#4845](https://github.com/scalableminds/webknossos/pull/4845)

### Removed
-
