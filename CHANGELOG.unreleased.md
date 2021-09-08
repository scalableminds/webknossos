# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.08.0...HEAD)

### Added
- Added a rudimentary version of openAPI docs for some routes. Available at `/swagger.json`. [#5693](https://github.com/scalableminds/webknossos/pull/5693)
- Added shortcuts K and L for toggling the left and right sidebars. [#5709](https://github.com/scalableminds/webknossos/pull/5709)

### Changed
- By default, if data is missing in one magnification, higher magnifications are used for rendering. This setting can be controlled via the left sidebar under "Render Missing Data Black". [#5703](https://github.com/scalableminds/webknossos/pull/5703)

### Fixed
- Fixed a bug where existing tasktypes with recommended configurations still had a property that is no longer valid. [#5707](https://github.com/scalableminds/webknossos/pull/5707)
- Fixed that segment IDs could not be copied to the clipboard. [#5709](https://github.com/scalableminds/webknossos/pull/5709)

### Removed
-

### Breaking Change
-
