# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.09.0...HEAD)

### Added
- Zarr-based remote dataset import now also works for public AWS S3 endpoints with no credentials. [#6421](https://github.com/scalableminds/webknossos/pull/6421)
- Added a context menu option to extract the shortest path between two nodes as a new tree. Select the source node and open the context menu by right-clicking on another node in the same tree. [#6423](https://github.com/scalableminds/webknossos/pull/6423)

### Changed
- The largestSegmentId is no longer a required property for segmentation layers. It is still recommended to set the property, since the generation of new segment IDs is blocked during volume annotation. However, annotating with manually set IDs is still possible. This change simplifies the import of datasets into webKnossos. [#6414](https://github.com/scalableminds/webknossos/pull/6414)

### Fixed

### Removed

### Breaking Changes
