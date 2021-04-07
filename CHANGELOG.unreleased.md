# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.04.0...HEAD)

### Added
- The names of Task Types and Projects no longer need to be globally unique, instead only within their respective organization.  [#5334](https://github.com/scalableminds/webknossos/pull/5334)
- Upgraded UI library antd to version 4, creating a slightly more modern look and behavior of many UI elements. [#5350](https://github.com/scalableminds/webknossos/pull/5350)

### Changed
- webKnossos is now part of the [image.sc support community](https://forum.image.sc/tag/webknossos). [#5332](https://github.com/scalableminds/webknossos/pull/5332)
- Meshes that are imported by the user in the meshes tab are now rendered the same way as generated isosurface meshes. [#5326](https://github.com/scalableminds/webknossos/pull/5326)
- In the new REST API version 4, projects are no longer referenced by name, but instead by id. [#5334](https://github.com/scalableminds/webknossos/pull/5334)

### Fixed
- Fixed a bug where some values in the project list were displayed incorrectly after pausing/unpausing the project. [#5339](https://github.com/scalableminds/webknossos/pull/5339)
- Fixed that editing a task type would always re-add the default values to the recommended configuration (if enabled). [#5341](https://github.com/scalableminds/webknossos/pull/5341)
- Fixed a bug where tasks created from existing volume annotations that did not have a specified bounding box were broken. [#5362](https://github.com/scalableminds/webknossos/pull/5361)

### Removed
-

### Breaking Change
-
