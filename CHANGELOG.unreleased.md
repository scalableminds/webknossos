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
- Added shortcuts K and L for toggling the left and right sidebars. [#5709](https://github.com/scalableminds/webknossos/pull/5709)

### Changed
- By default, if data is missing in one magnification, higher magnifications are used for rendering. This setting can be controlled via the left sidebar under "Render Missing Data Black". [#5703](https://github.com/scalableminds/webknossos/pull/5703)
- Refactor the format of the URL hash/fragment to alternatively use JSON. Old links will continue to work. [#5730](https://github.com/scalableminds/webknossos/pull/5730)


### Fixed
- Fixed a bug where existing tasktypes with recommended configurations still had a property that is no longer valid. [#5707](https://github.com/scalableminds/webknossos/pull/5707)
- Fixed that segment IDs could not be copied to the clipboard. [#5709](https://github.com/scalableminds/webknossos/pull/5709)
- Fixed a bug where volume annotation version restore skipped buckets that were not yet touched in the version to be restored. [#5717](https://github.com/scalableminds/webknossos/pull/5717)
- Fixed two volume tracing related bugs which could occur when using undo with a slow internet connection or when volume-annotating more than 5000 buckets (32**3 vx) in one session. [#5728](https://github.com/scalableminds/webknossos/pull/5728)
- Fixed a rendering bug showing non-existant or wrongly-colored edges that sometimes occurred after deleting edges, nodes, or trees. [#5724](https://github.com/scalableminds/webknossos/pull/5724)
- Fixed an error during viewport maximization in flight mode. Also, fixed a crash during minimization of the 3D-View for datasets with lots of magnnifications. [#5746](https://github.com/scalableminds/webknossos/pull/5746)

### Removed
-

### Breaking Change
-
