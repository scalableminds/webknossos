# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.1...HEAD)

### Added
- Added Volume Interpolation feature. When enabled, it suffices to only label every 2nd slice. The skipped slices will be filled automatically by interpolating between the labeled slices. This feature is disabled by default. Note that the feature is even forbidden for tasks by default, but can be enabled/recommended. [#6162](https://github.com/scalableminds/webknossos/pull/6162)
- Added a long-running job that applies the merging done via a merger mode tracing to a new output dataset. The job is accessible via a button next to the merger mode button once the merger mode is active. [#6086](https://github.com/scalableminds/webknossos/pull/6086)
- Added support to stream zarr files using the corresponding [zarr spec](https://zarr.readthedocs.io/en/stable/spec/v2.html#storage). [#6144](https://github.com/scalableminds/webknossos/pull/6144)

### Changed
- When creating a new annotation with a volume layer (without fallback) for a dataset which has an existing segmentation layer, the original segmentation layer is still listed (and viewable) in the left sidebar. Earlier versions simply hid the original segmentation layer. [#6186](https://github.com/scalableminds/webknossos/pull/6186)
- Changing the visibility of a layer within an annotation does not change the visibility of the layer when viewing the corresponding dataset. [#6186](https://github.com/scalableminds/webknossos/pull/6186)
- While viewing tracings in read-only mode, the options to manipulate the tracing are now disabled. This leads to less confusion as previously the input was silently discarded. [#6140](https://github.com/scalableminds/webknossos/pull/6140).
- Changed default of `dynamicSpaceDirection` property to false to avoid confusion. [#6162](https://github.com/scalableminds/webknossos/pull/6162)
- Changed the internal protocol for requesting image data. The zoomStep parameter has been replaced by mag. This increases the datastore API version to 2.0 [#6159](https://github.com/scalableminds/webknossos/pull/6159)
- In annotation list in dashboard, replaced the non-standard word “Trace” by “Open”. [#6191](https://github.com/scalableminds/webknossos/pull/6191)

### Fixed
- Fixed a bug in the task creation, where creation for some tasks with initial volume data would fail. [#6178](https://github.com/scalableminds/webknossos/pull/6178)
- Fixed a bug in the task cration, where creation for some tasks with initial volume data would fail. [#6178](https://github.com/scalableminds/webknossos/pull/6178)
- Fixed the 3d viewport for dataset with low voxel resolution by making the far clipping adaptive to the dataset [#6221](https://github.com/scalableminds/webknossos/pull/6221).
- Fixed a rendering bug which could cause an incorrect magnification to be rendered in rare scenarios. [#6029](https://github.com/scalableminds/webknossos/pull/6029)
- Fixed a bug which could cause a segmentation layer's "ID mapping" dropdown to disappear. [#6215](https://github.com/scalableminds/webknossos/pull/6215)

### Removed

### Breaking Changes
