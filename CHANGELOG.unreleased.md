# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.2...HEAD)

### Added
- Added a new tool that allows either measuring the distance of a path or a non-self-crossing area. [#7258](https://github.com/scalableminds/webknossos/pull/7258)
- Added social media link previews for links to datasets and annotations (only if they are public or if the links contain sharing tokens). [#7331](https://github.com/scalableminds/webknossos/pull/7331)
- Loading sharded zarr3 datasets is now significantly faster. [#7363](https://github.com/scalableminds/webknossos/pull/7363) and [#7370](https://github.com/scalableminds/webknossos/pull/7370)
- OME-NGFF datasets with only 2 dimensions can now be imported and viewed. [#7349](https://github.com/scalableminds/webknossos/pull/7349)
- Higher-dimension coordinates (e.g., for the t axis) are now encoded in the URL, too, so that reloading the page will keep you at your current position. Only relevant for 4D datasets. [#7328](https://github.com/scalableminds/webknossos/pull/7328)
- WEBKNOSSOS can now also explore datasets on the local file system if enabled in the new config key `datastore.localFolderWhitelist`. [#7389](https://github.com/scalableminds/webknossos/pull/7389)

### Changed
- Updated backend code to Scala 2.13, with upgraded Dependencies for optimized performance. [#7327](https://github.com/scalableminds/webknossos/pull/7327)
- Remote datasets with a datasource-properties.json can now also be imported without the need for OME metadata. [#7372](https://github.com/scalableminds/webknossos/pull/7372)
- Occurrences of isosurface were renamed to ad-hoc mesh. This also applies to configuration files. [#7350](https://github.com/scalableminds/webknossos/pull/7350)

### Fixed
- Fixed that some segment (group) actions were not properly disabled for non-editable segmentation layers. [#7207](https://github.com/scalableminds/webknossos/issues/7207)
- Fixed a bug where data from zarr2 datasets that have a channel axis was broken. [#7374](https://github.com/scalableminds/webknossos/pull/7374)
- Fixed a bug which changed the cursor position while editing the name of a tree or the comment of a node. [#7390](#https://github.com/scalableminds/webknossos/pull/7390)
- Streaming sharded zarr3 datasets from servers which do not respond with Accept-Ranges header is now possible. [#7392](https://github.com/scalableminds/webknossos/pull/7392)

### Removed

### Breaking Changes
