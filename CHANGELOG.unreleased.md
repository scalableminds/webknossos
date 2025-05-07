# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.05.0...HEAD)

### Added
- Added the possibility to join an organization without requiring a paid user slot in case an organization already pays for the same user. Such a user is called a "Guest User". [#8502](https://github.com/scalableminds/webknossos/pull/8502)

### Changed
- Remove `data.maybe` dependency and replaced with regular Typescript types. [#8563](https://github.com/scalableminds/webknossos/pull/8563)
- Updated `View Modes` documentation page with links for mouse and keyboard shortcuts. [#8582](https://github.com/scalableminds/webknossos/pull/8582)
- Renamed the button to view the compound annotation of all tasks of a tasktype to be more descriptive. [#8565](https://github.com/scalableminds/webknossos/pull/8565)
- Replaced fixed threshold of 40 meshes by a dynamic limit based on the number of triangles in the mesh for the "Create Animation" job. [#8588](https://github.com/scalableminds/webknossos/pull/8588) 
- Replaced Redux selector `useSelector((state: OxalisState) => ...)` with a typed `useWkSelector(state => ...)` shorthand. [#8591](https://github.com/scalableminds/webknossos/pull/8591)
- Renamed `OxalisState`, `OxalisApplication`, and `OxalisApi` to their respective `Webknossos{State, API, Application}` equivalent [#8591](https://github.com/scalableminds/webknossos/pull/8591)

### Fixed
- Fixed that layer bounding boxes were sometimes colored green even though this should only happen for tasks. [#8535](https://github.com/scalableminds/webknossos/pull/8535)
- Fixed that annotations could not be opened anymore (caused by #8535). [#8599](https://github.com/scalableminds/webknossos/pull/8599)

### Removed

### Breaking Changes
