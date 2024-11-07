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
- It is now possible to search for unnamed segments with the full default name instead of only their id. [#8133](https://github.com/scalableminds/webknossos/pull/8133)
- Increased loading speed for precomputed meshes. [#8110](https://github.com/scalableminds/webknossos/pull/8110)
- Added a button to the search popover in the skeleton and segment tab to select all matching non-group results. [#8123](https://github.com/scalableminds/webknossos/pull/8123)
- Unified wording in UI and code: “Magnification”/“mag” is now used in place of “Resolution“ most of the time, compare [https://docs.webknossos.org/webknossos/terminology.html](terminology document). [#8111](https://github.com/scalableminds/webknossos/pull/8111)
- Added support for adding remote OME-Zarr NGFF version 0.5 datasets. [#8122](https://github.com/scalableminds/webknossos/pull/8122)
- Workflow reports may be deleted by superusers. [#8156](https://github.com/scalableminds/webknossos/pull/8156)

### Changed
- Some mesh-related actions were disabled in proofreading-mode when using meshfiles that were created for a mapping rather than an oversegmentation. [#8091](https://github.com/scalableminds/webknossos/pull/8091)
- Admins can now see and cancel all jobs. The owner of the job is shown in the job list. [#8112](https://github.com/scalableminds/webknossos/pull/8112)
- Migrated nightly screenshot tests from CircleCI to GitHub actions. [#8134](https://github.com/scalableminds/webknossos/pull/8134)
- Migrated nightly screenshot tests for wk.org from CircleCI to GitHub actions. [#8135](https://github.com/scalableminds/webknossos/pull/8135)
- Thumbnails for datasets now use the selected mapping from the view configuration if available. [#8157](https://github.com/scalableminds/webknossos/pull/8157)

### Fixed
- Fixed a bug during dataset upload in case the configured `datastore.baseFolder` is an absolute path. [#8098](https://github.com/scalableminds/webknossos/pull/8098) [#8103](https://github.com/scalableminds/webknossos/pull/8103)
- Fixed bbox export menu item [#8152](https://github.com/scalableminds/webknossos/pull/8152)
- When trying to save an annotation opened via a link including a sharing token, the token is automatically discarded in case it is insufficient for update actions but the users token is. [#8139](https://github.com/scalableminds/webknossos/pull/8139)
- Fixed that uploading a dataset which needs a conversion failed when the angstrom unit was configured for the conversion. [#8173](https://github.com/scalableminds/webknossos/pull/8173)
- Fixed that the skeleton search did not automatically expand groups that contained the selected tree [#8129](https://github.com/scalableminds/webknossos/pull/8129)
- Fixed a bug that zarr streaming version 3 returned the shape of mag (1, 1, 1) / the finest mag for all mags. [#8116](https://github.com/scalableminds/webknossos/pull/8116)
- Fixed sorting of mags in outbound zarr streaming. [#8125](https://github.com/scalableminds/webknossos/pull/8125)
- Fixed a bug where you could not create annotations for public datasets of other organizations. [#8107](https://github.com/scalableminds/webknossos/pull/8107)
- Users without edit permissions to a dataset can no longer delete sharing tokens via the API. [#8083](https://github.com/scalableminds/webknossos/issues/8083)
- Fixed downloading task annotations of teams you are not in, when accessing directly via URI. [#8155](https://github.com/scalableminds/webknossos/pull/8155)
- Removed unnecessary scrollbars in skeleton tab that occurred especially after resizing. [#8148](https://github.com/scalableminds/webknossos/pull/8148)
- Deleting a bounding box is now possible independently of a visible segmentation layer. [#8164](https://github.com/scalableminds/webknossos/pull/8164)
- S3-compliant object storages can now be accessed via HTTPS. [#8167](https://github.com/scalableminds/webknossos/pull/8167)

### Removed

### Breaking Changes
