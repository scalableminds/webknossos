# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.10.0...HEAD)

### Added
- It is now possible to add metadata in annotations to Trees and Segments. [#7875](https://github.com/scalableminds/webknossos/pull/7875)
- Added a summary row to the time tracking overview, where times and annotations/tasks are summed. [#8092](https://github.com/scalableminds/webknossos/pull/8092)
- Most sliders have been improved: Wheeling above a slider now changes its value and double-clicking its knob resets it to its default value. [#8095](https://github.com/scalableminds/webknossos/pull/8095)
- Increased loading speed for precomputed meshes. [#8110](https://github.com/scalableminds/webknossos/pull/8110)
- Unified wording in UI and code: “Magnification”/“mag” is now used in place of “Resolution“ most of the time, compare [https://docs.webknossos.org/webknossos/terminology.html](terminology document). [#8111](https://github.com/scalableminds/webknossos/pull/8111)

### Changed
- Some mesh-related actions were disabled in proofreading-mode when using meshfiles that were created for a mapping rather than an oversegmentation. [#8091](https://github.com/scalableminds/webknossos/pull/8091)
- Admins can now see and cancel all jobs. The owner of the job is shown in the job list. [#8112](https://github.com/scalableminds/webknossos/pull/8112)

### Fixed
- Fixed a bug during dataset upload in case the configured `datastore.baseFolder` is an absolute path. [#8098](https://github.com/scalableminds/webknossos/pull/8098) [#8103](https://github.com/scalableminds/webknossos/pull/8103)
- Fixed that the skeleton search did not automatically expand groups that contained the selected tree [#8129](https://github.com/scalableminds/webknossos/pull/8129)
- Fixed a bug that zarr streaming version 3 returned the shape of mag (1, 1, 1) / the finest mag for all mags. [#8116](https://github.com/scalableminds/webknossos/pull/8116)
- Fixed a bug where you could not create annotations for public datasets of other organizations. [#8107](https://github.com/scalableminds/webknossos/pull/8107)
- Users without edit permissions to a dataset can no longer delete sharing tokens via the API. [#8083](https://github.com/scalableminds/webknossos/issues/8083)

### Removed

### Breaking Changes
