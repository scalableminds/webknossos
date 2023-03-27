# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.03.1...HEAD)

### Added
- Added support for datasets where layers are transformed individually (with an affine matrix). Transformations can be specified via datasource-properties.json or via JS API (will be ephemeral, then). [#6748](https://github.com/scalableminds/webknossos/pull/6748)
- Added list of all respective team members to the administration page for teams. [#6915](https://github.com/scalableminds/webknossos/pull/6915)
- Added email notifications for WK worker jobs. [#6918](https://github.com/scalableminds/webknossos/pull/6918)
- Added support for viewing sharded neuroglancer precomputed datasets. [#6920](https://github.com/scalableminds/webknossos/pull/6920)

### Changed
- Interpolation during rendering is now more performance intensive, since the rendering approach was changed. Therefore, interpolation is disabled by default. On the flip side, the rendered quality is often higher than it used to be. [#6748](https://github.com/scalableminds/webknossos/pull/6748)
- Updated the styling of the "welcome" screen for new users to be in line with the new branding. [#6904](https://github.com/scalableminds/webknossos/pull/6904)
- Improved Terms-of-Service modal (e.g., allow to switch organization even when modal was blocking the remaining usage of WEBKNOSSOS). [#6930](https://github.com/scalableminds/webknossos/pull/6930)

### Fixed
- Fixed an issue with text hints not being visible on the logout page for dark mode users. [#6916](https://github.com/scalableminds/webknossos/pull/6916)
- Fixed creating task types with a selected preferred mode. [#6928](https://github.com/scalableminds/webknossos/pull/6928)
- Fixed support for rendering of negative floats. [#6895](https://github.com/scalableminds/webknossos/pull/6895)
- Fixed caching issues with webworkers. [#6932](https://github.com/scalableminds/webknossos/pull/6932)
- Fixed download button for annotations which was disabled in some cases. [#6931](https://github.com/scalableminds/webknossos/pull/6931)
- Fixed antd deprecation warning for Dropdown menus. [#6898](https://github.com/scalableminds/webknossos/pull/6898)
### Removed

### Breaking Changes
