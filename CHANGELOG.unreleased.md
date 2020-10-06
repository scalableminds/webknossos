# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.10.0...HEAD)

### Added
- Added multi-resolution volume annotations. Note that already existing volume tracings will still only contain data in the first magnification. If you want to migrate an old volume tracing, you can download and re-import it. [#4755](https://github.com/scalableminds/webknossos/pull/4755)            

### Changed
- New volume/hybrid annotations are now automatically multi-resolution volume annotations. [#4755](https://github.com/scalableminds/webknossos/pull/4755)
- The position input of tracings now accepts decimal input. When losing focus the values are cut off at the comma. [#4803](https://github.com/scalableminds/webknossos/pull/4803)
- webknossos.org only: Accounts associated with new organizations can now be created even when a datastore is unreachable. The necessary folders are created lazily when needed. [#4846](https://github.com/scalableminds/webknossos/pull/4846)

### Fixed
- Fixed failing histogram requests for float layers with NaN values. [#4834](https://github.com/scalableminds/webknossos/pull/4834)

### Removed
-
