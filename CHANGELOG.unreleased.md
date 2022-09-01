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
- Added a context menu option to separate an agglomerate skeleton using Min-Cut. Activate the Proofreading tool, select the source node and open the context menu by right-clicking on the target node which you would like to separate through Min-Cut. [#6361](https://github.com/scalableminds/webknossos/pull/6361)

### Changed

### Fixed

### Removed

### Breaking Changes
