# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.2...HEAD)

### Added
- Added segment groups so that segments can be organized in a hierarchy (similar to skeletons). [#6966](https://github.com/scalableminds/webknossos/pull/6966)
- In addition to drag and drop, the selected tree(s) in the Skeleton tab can also be moved into another group by right-clicking the target group and selecting "Move selected tree(s) here". [#7005](https://github.com/scalableminds/webknossos/pull/7005)
- Added a machine-learning based quick select mode. Activate it via the "AI" button in the toolbar after selecting the quick-select tool. [#7051](https://github.com/scalableminds/webknossos/pull/7051)
- Added support for remote datasets encoded with [brotli](https://datatracker.ietf.org/doc/html/rfc7932). [#7041](https://github.com/scalableminds/webknossos/pull/7041)
- Teams can be edited more straight-forwardly in a popup in the team edit page. [#7043](https://github.com/scalableminds/webknossos/pull/7043)
- Annotations with Editable Mappings (a.k.a Supervoxel Proofreading) can now be merged. [#7026](https://github.com/scalableminds/webknossos/pull/7026)
- The file size and inodes of artifacts are now aggregated and shown in the Voxelytics workflow list. [#7071](https://github.com/scalableminds/webknossos/pull/7071)
- It is possible to disable the automatic loading of meshes during proofreading. [##7076](https://github.com/scalableminds/webknossos/pull/7076)

### Changed
- Loading of precomputed meshes got significantly faster (especially when using a mesh file for an oversegmentation with an applied agglomerate mapping). [#7001](https://github.com/scalableminds/webknossos/pull/7001)
- Improved speed of proofreading by only reloading affected areas after a split or merge. [#7050](https://github.com/scalableminds/webknossos/pull/7050)
- The minimum length of layer names in datasets was set from 3 to 1, enabling single-character names for layers. [#7064](https://github.com/scalableminds/webknossos/pull/7064)
- All dataset managers are now allowed to see all voxelytics workflow reports created in their organization. Previously, only admins could see all workflow reports, with other users seeing only their own. [#7080](https://github.com/scalableminds/webknossos/pull/7080)
- Improved performance for large meshes, especially when loaded from a precomputed oversegmentation mesh file. [#7077](https://github.com/scalableminds/webknossos/pull/7077)

### Fixed
- Fixed that changing a segment color could lead to a crash. [#7000](https://github.com/scalableminds/webknossos/pull/7000)
- The fill_value property of zarr dataset is now used when it is not a number. [#7017](https://github.com/scalableminds/webknossos/pull/7017)
- Fixed a bug that made downloads of public annotations fail occasionally. [#7025](https://github.com/scalableminds/webknossos/pull/7025)
- Fixed layouting of used storage space on the organization page. [#7034](https://github.com/scalableminds/webknossos/pull/7034)
- Fixed a bug where updating skeleton annotation tree group visibility would break the annotation. [#7037](https://github.com/scalableminds/webknossos/pull/7037)
- Fixed importing Neuroglancer Precomputed datasets that have a voxel offset in their header. [#7019](https://github.com/scalableminds/webknossos/pull/7019), [#7062](https://github.com/scalableminds/webknossos/pull/7062)
- Fixed reading Neuroglancer Precomputed datasets with non-integer resolutions. [#7041](https://github.com/scalableminds/webknossos/pull/7041)
- Fixed a bug where invalid email addresses were not readable in dark mode on the login/signup pages. [#7052](https://github.com/scalableminds/webknossos/pull/7052)
- Fixed a bug where users could sometimes not access their own time tracking information. [#7055](https://github.com/scalableminds/webknossos/pull/7055)
- Fixed a bug in the wallTime calculation of the Voxelytics reports. [#7059](https://github.com/scalableminds/webknossos/pull/7059) 
- Fixed a bug where thumbnails and raw data requests with non-bucket-aligned positions would show data at slightly wrong positions. [#7058](https://github.com/scalableminds/webknossos/pull/7058)
- Avoid crashes when exporting big STL files. [#7074](https://github.com/scalableminds/webknossos/pull/7074)
- Fixed rare rendering bug for datasets with multiple layers and differing magnifications. [#7066](https://github.com/scalableminds/webknossos/pull/7066)
- Fixed a bug where duplicating annotations with Editable Mappings could lead to a server-side endless loop. [#7026](https://github.com/scalableminds/webknossos/pull/7026)
- Fixed the datasource-properties.json route for zarr-streaminge export of datasets that are not wkw/zarr.  [#7065](https://github.com/scalableminds/webknossos/pull/7065)
- Fixed an issue where you could no longer invite users to your organization even though you had space left. [#7078](https://github.com/scalableminds/webknossos/pull/7078)
- Fixed displayed units of used storage in the organization's overview page. [#7057](https://github.com/scalableminds/webknossos/pull/7057)
- Fixed a rendering bug that could occur when a dataset layer has missing mags (e.g., the first mag is 8-8-8). [#7082](https://github.com/scalableminds/webknossos/pull/7082)
- Fixed a bug where some volume annotations could not be duplicated or used as tasks. [#7085](https://github.com/scalableminds/webknossos/pull/7085)
- Fixed a superfluous rectangular geometry rendered at 0,0,0. [#7088](https://github.com/scalableminds/webknossos/pull/7088)

### Removed
- Support for [webknososs-connect](https://github.com/scalableminds/webknossos-connect) data store servers has been removed. Use the "Add Remote Dataset" functionality instead. [#7031](https://github.com/scalableminds/webknossos/pull/7031)

### Breaking Changes
