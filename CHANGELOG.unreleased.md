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
- Added support for datasets that have multiple segmentation layers. Note that only one segmentation layer can be rendered at a time, currently. [#5683](https://github.com/scalableminds/webknossos/pull/5683)

### Changed
- By default, if data is missing in one magnification, higher magnifications are used for rendering. This setting can be controlled via the left sidebar under "Render Missing Data Black". [#5703](https://github.com/scalableminds/webknossos/pull/5703)

### Fixed
-

### Removed
-

### Breaking Change
-
