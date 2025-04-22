# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.03.1...HEAD)

### Added
- Allow to mirror datasets along an axis in the dataset settings as part of the rotation feature. [#8485](https://github.com/scalableminds/webknossos/pull/8485)
- The opacity of meshes can be adjusted using the 'Change Segment Color' context menu entry in the segments tab. [#8443](https://github.com/scalableminds/webknossos/pull/8443)
- Performance improvements for volume annotation save requests. [#8460](https://github.com/scalableminds/webknossos/pull/8460)
- Performance improvements for segment statistics (volume + bounding box in context menu). [#8469](https://github.com/scalableminds/webknossos/pull/8469)
- Added that the dataset name is automatically corrected in view mode URLs upon loading. [#8514](https://github.com/scalableminds/webknossos/pull/8514)
- Upgraded backend dependencies for improved performance and stability. [#8507](https://github.com/scalableminds/webknossos/pull/8507)
- New config option `datastore.dataVaults.credentials` allows admins to set up global credentials for remote dataset loading. [#8509](https://github.com/scalableminds/webknossos/pull/8509)

### Changed
- When deleting a dataset / layer, layers that are referenced in other datasets are moved there instead of being deleted. [#8437](https://github.com/scalableminds/webknossos/pull/8437/)
- Added a parameter to the reserve manual upload route allowing to make the request fail if the name is already taken. Moreover, the new dataset's id and directory name are returned in the response. [#8476](https://github.com/scalableminds/webknossos/pull/8476)
- The skeleton tool can no longer be activated if the skeleton layer is invisible. [#8501](https://github.com/scalableminds/webknossos/pull/8501)
- Improved speed of mesh rendering and mouse interaction in 3D viewport. [#8106](https://github.com/scalableminds/webknossos/pull/8106)
- Numbered docker image now use different and larger numbers. [#8147](https://github.com/scalableminds/webknossos/pull/8147)
- Replace frontend unit testing framework `ava` with `vitest`. Minimum required nodejs version is now `22+`. [#8479](https://github.com/scalableminds/webknossos/pull/8479)

### Fixed
- Fixed a Bug where the "Save view configuration as default" modal's text included undefined.  [#8514](https://github.com/scalableminds/webknossos/pull/8514)
- Fixed the alignment of the button that allows restricting floodfill operations to a bounding box. [#8388](https://github.com/scalableminds/webknossos/pull/8388) 
- Fixed that it was possible to trigger the find largest segment id job on layers which are not stored as segmentation layers on the server. [#8503](https://github.com/scalableminds/webknossos/pull/8503)
- Fixed that adding a layer using the dataset settings' advanced tab would crash WEBKNOSSOS. Bug was introduced by [#8503](https://github.com/scalableminds/webknossos/pull/8503).  [#8550](https://github.com/scalableminds/webknossos/pull/8550)
- Fixed a rare and subtle bug related to volume annotation and undo/redo. [#7506](https://github.com/scalableminds/webknossos/pull/7506)
- Fixed a bug where segment statistics would sometimes be wrong in case of an on-disk segmentation fallback layer with segment index file. [#8460](https://github.com/scalableminds/webknossos/pull/8460)
- Fixed a bug where sometimes outdated segment statistics would be displayed. [#8460](https://github.com/scalableminds/webknossos/pull/8460)
- Fixed a bug where outbound zarr streaming would contain a typo in the zarr header dimension_separator field. [#8510](https://github.com/scalableminds/webknossos/pull/8510)
- Fixed a bug where sometimes large skeletons were not saved correctly, making them inaccessible on the next load. [#8513](https://github.com/scalableminds/webknossos/pull/8513)
- Fixed that meshes weren't loaded correctly if the precomputed mesh file contained multiple levels-of-detail. [#8519](https://github.com/scalableminds/webknossos/pull/8519)
- Fixed that authentication-related token renewal did not work properly in certain scenarios. [#8532](https://github.com/scalableminds/webknossos/pull/8532)

### Removed

### Breaking Changes
- Removed `docker-compose.yml` in favor of `tools/hosting/docker-compose.yml` [#8147](https://github.com/scalableminds/webknossos/pull/8147)
