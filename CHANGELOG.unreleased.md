# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.11.0...HEAD)

### Added
- Added tagging support for datasets. [#5832](https://github.com/scalableminds/webknossos/pull/5832)

### Changed
-

### Fixed
- Fixed a bug where dataset uploads that contained files larger than 2 GB failed. [#5889](https://github.com/scalableminds/webknossos/pull/5889)
- Fixed that dataset uploads did not survive back-end restarts. [#5831](https://github.com/scalableminds/webknossos/pull/5831)
- Fixed a bug where NMLs with unconnected trees and nested tree groups could not be uploaded due to wrong tree group IDs. [#5893](https://github.com/scalableminds/webknossos/pull/5893)

### Removed
-

### Breaking Change
- When using the front-end API, functions that accept a layer name, such as `api.data.getDataValue`, won't interpret the name "segmentation" as the current volume tracing if it exists. Instead, "segmentation" can only be used if the current dataset has a layer which is named "segmentation". If you want to interact with the volume tracing layer, use `api.data.getVolumeTracingLayerIds()` instead. Also see `api.data.getSegmentationLayerNames` and `api.data.getVisibleSegmentationLayer`. [#5771](https://github.com/scalableminds/webknossos/pull/5771)
