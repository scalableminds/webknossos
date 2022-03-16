# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/release-YY.MM...HEAD)

### Added
- The visible meshes are now included in the link copied from the "Share" modal or the "Share" button next to the dataset position. They are automatically loaded for users that open the shared link. [#5993](https://github.com/scalableminds/webknossos/pull/5993)
- Added a new "Connectome Tab" which can be used to explore connectomes by visualizing neurites and their synaptic connections. Connectome files need to be placed in a `connectomes` folder inside of the respective segmentation layer. It is possible to craft links that automatically load specific agglomerates and their synapses when openend. For more information refer to https://docs.webknossos.org/webknossos/sharing.html#sharing-link-format. [#5894](https://github.com/scalableminds/webknossos/pull/5894)
- Added a context-menu option when right-clicking on skeleton trees to hide/show all other trees but the selected one. Great for inspecting a single tree in isolation. Identical to keyboard shortcut "2". [#6102](https://github.com/scalableminds/webknossos/pull/6102)

### Changed
- The maximum brush size now depends on the available magnifications. Consequentially, one can use a larger brush size when the magnifications of a volume layer are restricted. [#6066](https://github.com/scalableminds/webknossos/pull/6066)
- Improved stability and speed of volume annotations when annotating large areas. [#6055](https://github.com/scalableminds/webknossos/pull/6055)
- In dataset upload, linking layers of existing datasets is no longer restricted to public datasets. [#6097](https://github.com/scalableminds/webknossos/pull/6097)
- Deactivating users with currently active tasks is no longer allowed. [#6099](https://github.com/scalableminds/webknossos/pull/6099)

### Fixed
- Fixed a bug that led to crashing the layer settings once the icon for the downsample modal was clicked. [#6058](https://github.com/scalableminds/webknossos/pull/6058)
- Fixed a bug where toggling between not archived and archived annotations in the "My Annotation" of the dashboard led to inconsistent states and duplicates of annotations. [#6058](https://github.com/scalableminds/webknossos/pull/6058)
- Fixed a bug where deactivated users would still be listed as allowed to access the datasets of their team. [#6070](https://github.com/scalableminds/webknossos/pull/6070)
- Fix occasionally "disappearing" data. [#6055](https://github.com/scalableminds/webknossos/pull/6055)
- Fixed a bug where remote-origin headers were omitted in error case. [#6098](https://github.com/scalableminds/webknossos/pull/6098)
- Increased the timeouts for some internal operations like downsampling volume annotations. [#6103](https://github.com/scalableminds/webknossos/pull/6103)
- Fixed a bug that led to an error when drag-'n-dropping an empty volume annotation in the dataset view. [#6116](https://github.com/scalableminds/webknossos/pull/6116)
- Fixed a bug where there was a suggested change in the `datasource-config.json` was shown for resolution `1` instead of `[1,1,1]` or vice-versa. [#6104](https://github.com/scalableminds/webknossos/pull/6104)

### Removed
- The previously disabled Import Skeleton Button has been removed. The functionality is available via the context menu for datasets with active ID mappings. [#6073](https://github.com/scalableminds/webknossos/pull/6073)
- Removes experimental (and hidden) automatic brushing feature. Consequentially, the corresponding feature flag `autoBrushReadyDatasets` is not used, anymore. [#6107](https://github.com/scalableminds/webknossos/pull/6107)

### Breaking Changes
