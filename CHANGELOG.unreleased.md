# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.09.0...HEAD)

### Added
- Added a new bounding box tool that allows resizing and creating bounding boxes more easily. Additionally, the context menu now contains options to modify the bounding box close to the clicked position. [#5767](https://github.com/scalableminds/webknossos/pull/5767)

### Changed
-

### Fixed
-

### Removed
-

### Breaking Change
- When using the front-end API, functions that accept a layer name, such as `api.data.getDataValue`, won't interpret the name "segmentation" as the current volume tracing if it exists. Instead, "segmentation" can only be used if the current dataset has a layer which is named "segmentation". If you want to interact with the volume tracing layer, use `api.data.getVolumeTracingLayerIds()` instead. Also see `api.data.getSegmentationLayerNames` and `api.data.getVisibleSegmentationLayer`. [#5771](https://github.com/scalableminds/webknossos/pull/5771)
