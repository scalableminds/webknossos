# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.05.1...HEAD)

### Added
- Added the option to hide the plane borders and crosshairs in the 3D viewport. Also, this setting was moved from the "Other" section of the user settings to the 3D viewport. Additionally, added a setting to hide the dataset bounding box in the 3D view. [#5440](https://github.com/scalableminds/webknossos/pull/5440)
- Added an icon to the info tab of a tracing that links to the dataset settings. It's located next to the dataset name. [#4772](https://github.com/scalableminds/webknossos/pull/5462)

### Changed
-

### Fixed
- Fixed that the row selection in the user table wasn't properly preserved when filtering the table and (un)selecting rows. [#5486](https://github.com/scalableminds/webknossos/pull/5486)
- Fixed a bug where histograms generation failed for tiny datasets. [#5458](https://github.com/scalableminds/webknossos/pull/5458)
- Fixed a bug where NMLs with huge tree IDs uploaded via back-end produced broken annotations. [#5484](https://github.com/scalableminds/webknossos/pull/5484)
- Fixed a bug that led to various possible inconsistencies in the dataset settings in the datasource tab, when the inferred datasource properties suggested by the backend were accepted by the user. [#5492](https://github.com/scalableminds/webknossos/pull/5492)
- Fixed a bug where the upload of multiple NMLs failed if some of them have an organization attribute and others don’t. [#5483](https://github.com/scalableminds/webknossos/pull/5483)

### Removed
- Removed the button to load or refresh the isosurface of the centered cell from the 3D view. Instead, this action can be triggered from the "Meshes" tab. [#5440](https://github.com/scalableminds/webknossos/pull/5440)

### Breaking Change
-
