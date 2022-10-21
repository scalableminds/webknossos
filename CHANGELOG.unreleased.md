# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.10.0...HEAD)

### Added
- The task creation page now links to creation pages for task types, projects etc., for a smoother task administration experience. [#6513](https://github.com/scalableminds/webknossos/pull/6513)
- Support for a new mesh file format which allows up to billions of meshes. [#6491](https://github.com/scalableminds/webknossos/pull/6491)
- Remote n5 datasets can now also be explored and added. [#6520](https://github.com/scalableminds/webknossos/pull/6520)
- Improved performance for applying agglomerate mappings on segmentation data. [#6532](https://github.com/scalableminds/webknossos/pull/6532)
- Added backspace as an additional keyboard shortcut for deleting the active node. [#6554](https://github.com/scalableminds/webknossos/pull/6554)
- Tasks can now be assigned to individual users directly. [#6551](https://github.com/scalableminds/webknossos/pull/6551)
- When reloading a layer, because the underlying data has changed, the histogram will also be reloaded and reflect the changes. [#6537](https://github.com/scalableminds/webknossos/pull/6537)
- Enable "What's New" update information for all instances. [#6563](https://github.com/scalableminds/webknossos/pull/6563)
- Add context-menu option to delete skeleton root group. [#6553](https://github.com/scalableminds/webknossos/pull/6553)
- Added remaining task time estimation (ETA) for Voxelytics tasks in workflow reporting. [#6564](https://github.com/scalableminds/webknossos/pull/6564)
- Added a help button to the UI to send questions and feedbacks to the dev team. [#6560](https://github.com/scalableminds/webknossos/pull/6560)


### Changed
- Creating tasks in bulk now also supports referencing task types by their summary instead of id. [#6486](https://github.com/scalableminds/webknossos/pull/6486)
- Navbar changes: Move dropdown menu into separate Menu button. Removed toggle-button (cog icon)for left-hand side bar from navbar. [#6558](https://github.com/scalableminds/webknossos/pull/6558)
- Upgraded Typescript to v4.8 [#6567](https://github.com/scalableminds/webknossos/pull/6567)
- When merging annotations, bounding boxes are no longer duplicated. [#6576](https://github.com/scalableminds/webknossos/pull/6576)

### Fixed
- Fixed a bug where some file requests replied with error 400 instead of 404, confusing some zarr clients. [#6515](https://github.com/scalableminds/webknossos/pull/6515)
- Fixed URL for private Zarr streaming links to volume annotations. [#6515](https://github.com/scalableminds/webknossos/pull/6541)
- Fixed a bug where the `transform` of a new mesh file wasn't taken into account for the rendering of meshes. [#6552](https://github.com/scalableminds/webknossos/pull/6552) 
- Fixed a rare crash when splitting/merging a large skeleton. [#6557](https://github.com/scalableminds/webknossos/pull/6557)
- Fixed a bug where some features were unavailable for annotations for datasets of foreign organizations. [#6548](https://github.com/scalableminds/webknossos/pull/6548)

### Removed

### Breaking Changes
