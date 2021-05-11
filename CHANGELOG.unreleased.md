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
- Added a screenshot of the 3D view when using the screenshot functionality in the tracing view. [#5324](https://github.com/scalableminds/webknossos/pull/5324)
- Tiff export jobs of volume annotations now show the link back to the annotation in the jobs list. [#5378](https://github.com/scalableminds/webknossos/pull/5378)
- Added support for flight- and oblique-mode when having non-uint8 dataset layers. [#5396](https://github.com/scalableminds/webknossos/pull/5396)
- Added a dark theme for webKnossos. [#5407](https://github.com/scalableminds/webknossos/pull/5407)

### Changed
- webKnossos is now part of the [image.sc support community](https://forum.image.sc/tag/webknossos). [#5332](https://github.com/scalableminds/webknossos/pull/5332)
- Meshes that are imported by the user in the meshes tab are now rendered the same way as generated isosurface meshes. [#5326](https://github.com/scalableminds/webknossos/pull/5326)
- In the new REST API version 4, projects are no longer referenced by name, but instead by id. [#5334](https://github.com/scalableminds/webknossos/pull/5334)
- The layout of the tracing view was revamped. Most notably, the layout now has two well-behaved sidebars (left and right) which can be collapsed and expanded while the remaining space is used for the main data view. Additionally, a status bar was added which shows important information, such as the currently rendered magnification and useful mouse controls. [#5279](https://github.com/scalableminds/webknossos/pull/5279)
- The deployment configuration of webKnossos was cleaned up. If you host your own webKnossos instance, be sure to update your config according to the migration guide. [#5208](https://github.com/scalableminds/webknossos/pull/5208)

### Fixed
- Fixed a bug where some values in the project list were displayed incorrectly after pausing/unpausing the project. [#5339](https://github.com/scalableminds/webknossos/pull/5339)
- Fixed that editing a task type would always re-add the default values to the recommended configuration (if enabled). [#5341](https://github.com/scalableminds/webknossos/pull/5341)
- Fixed a bug where tasks created from existing volume annotations that did not have a specified bounding box were broken. [#5362](https://github.com/scalableminds/webknossos/pull/5361)
- Fixed broken search functionality in select components. [#5394](https://github.com/scalableminds/webknossos/pull/5394)
- Fixed a bug which could cause corrupted trees when CTRL+Rightclick was used in an empty tree. [#5385](https://github.com/scalableminds/webknossos/pull/5385)
- Fixed a bug in Safari which could cause an error message (which is safe to ignore). [#5373](https://github.com/scalableminds/webknossos/pull/5373)
- Fixed artifacts in screenshots near the dataset border. [#5324](https://github.com/scalableminds/webknossos/pull/5324)
- Fixed a bug where the page would scroll up unexpectedly when showing various confirm modals. [#5371](https://github.com/scalableminds/webknossos/pull/5371)
- Fixed a bug where user changes (email, activation) would show as successful even if they actually failed. [#5392](https://github.com/scalableminds/webknossos/pull/5392)
- Fixed a bug where dataset uploads were sent to the wrong datastore, and failed [#5404](https://github.com/scalableminds/webknossos/pull/5404)
- Fixed a bug where users could see long-running jobs listing of other users [#5435](https://github.com/scalableminds/webknossos/pull/5435)
- Fixed a rendering bug which occurred when the initial layout had a hidden 3D viewport. [#5429](https://github.com/scalableminds/webknossos/pull/5429)
- Fixed an incorrect initial camera rotation in the 3D viewport and an incorrect initial zoom value. [#5453](https://github.com/scalableminds/webknossos/pull/5453)
- Fixed a bug where the task search showed duplicates if a user had multiple instances of a task (as made possible by the transfer functionality). [#5456](https://github.com/scalableminds/webknossos/pull/5456)
- Fixed a bug where showing active users of a project, and transferring their tasks was broken. [#5456](https://github.com/scalableminds/webknossos/pull/5456)
- Fixed that the row selection in the user table wasn't properly preserved when filtering the table and (un)selecting rows. [#5486](https://github.com/scalableminds/webknossos/pull/5486)

### Removed
-

### Breaking Change
-
