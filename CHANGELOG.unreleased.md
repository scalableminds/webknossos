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
- Added a "clear" button to reset skeletons/meshes after successful mergers/split. [#6459](https://github.com/scalableminds/webknossos/pull/6459)
- The proofreading tool now supports merging and splitting (via min-cut) agglomerates by rightclicking a segment (and not a node). Note that there still has to be an active node so that both partners of the operation are defined. [#6464](https://github.com/scalableminds/webknossos/pull/6464)

### Changed
- Sharing links are shortened by default. Within the sharing modal, this shortening behavior can be disabled. [#6461](https://github.com/scalableminds/webknossos/pull/6461)

### Fixed
- Fixed sharing button for users who are currently visiting a dataset or annotation which was shared with them. [#6438](https://github.com/scalableminds/webknossos/pull/6438)
- Fixed the duplicate function for annotations with an editable mapping (a.k.a. supervoxel proofreading) layer. [#6446](https://github.com/scalableminds/webknossos/pull/6446)
- Fixed isosurface loading for volume annotations with mappings. [#6458](https://github.com/scalableminds/webknossos/pull/6458)
- Fixed importing of remote datastore (e.g., zarr) when datastore is set up separately. [#6462](https://github.com/scalableminds/webknossos/pull/6462)
- Fixed a crash which could happen when using the "Automatically clip histogram" feature in certain scenarios. [#6433](https://github.com/scalableminds/webknossos/pull/6433)
- Fixed loading agglomeate skeletons for agglomerate ids larger than 2^31. [#6472](https://github.com/scalableminds/webknossos/pull/6472)

### Removed

### Breaking Changes
