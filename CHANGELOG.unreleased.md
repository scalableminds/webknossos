# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.01.0...HEAD)

### Added
- It is now possible to start a split-merger evaluation when starting a neuron inference. [#8221](https://github.com/scalableminds/webknossos/pull/8221)
- Added the possibility to configure a rotation for a dataset, which can be toggled off and on when viewing and annotating data. [#8159](https://github.com/scalableminds/webknossos/pull/8159)
- When using the “Restore older Version” feature, there are no longer separate tabs for the different annotation layers. Only one linear annotation history is now used, and if you revert to an older version, all layers are reverted. If layers were added/deleted since then, that is also reverted. This also means that proofreading annotations can now be reverted to older versions as well. The description text of annotations is now versioned as well. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
- Added the possibility to use the "merger mode" even when the user has annotated volume data in the current layer (as long as no other mapping is active). [#8335](https://github.com/scalableminds/webknossos/pull/8335)
- Measurement tools are now accessible when viewing datasets outside of an annotation. [#8334](https://github.com/scalableminds/webknossos/pull/8334)

### Changed
- Improved the scrolling behaviour of sliders: Sliders must be focused to scroll them. Additionally, parent element scrolling is prevented when using the slider. [#8321](https://github.com/scalableminds/webknossos/pull/8321) [#8321](https://github.com/scalableminds/webknossos/pull/8321)

### Fixed
- Fixed a silent bug in the dashboard when refreshing newest dataset list. [#8386](https://github.com/scalableminds/webknossos/pull/8386) 
- Fixed a bug that lead to trees being dropped when merging to trees together. [#8359](https://github.com/scalableminds/webknossos/pull/8359)
- Fixed that the onboarding screen incorrectly appeared when a certain request failed. [#8356](https://github.com/scalableminds/webknossos/pull/8356)
- Fixed the segment registering in coarser mags for non-mag-aligned bounding boxes. [#8364](https://github.com/scalableminds/webknossos/pull/8364)

### Removed
 - Removed the feature to downsample existing volume annotations. All new volume annotations had a whole mag stack since [#4755](https://github.com/scalableminds/webknossos/pull/4755) (four years ago). [#7917](https://github.com/scalableminds/webknossos/pull/7917)

### Breaking Changes
