# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.07.0...HEAD)

### Added
- WEBKNOSSOS now automatically searches in subfolder / sub-collection identifiers for valid datasets in case a provided link to a remote dataset does not directly point to a dataset. [#7912](https://github.com/scalableminds/webknossos/pull/7912)
- Added the option to move a bounding box via dragging while pressing ctrl / meta. [#7892](https://github.com/scalableminds/webknossos/pull/7892)
- Added route `/import?url=<url_to_datasource>` to automatically import and view remote datasets. [#7844](https://github.com/scalableminds/webknossos/pull/7844)
- Added that newly created, modified and clicked on bounding boxes are now highlighted and scrolled into view, while the bounding box tool is active. [#7935](https://github.com/scalableminds/webknossos/pull/7935)
- Added option to expand or collapse all subgroups of a segment group in the segments tab. [#7911](https://github.com/scalableminds/webknossos/pull/7911)
- The context menu that is opened upon right-clicking a segment in the dataview port now contains the segment's name. [#7920](https://github.com/scalableminds/webknossos/pull/7920) 
- Upgraded backend dependencies for improved performance and stability. [#7922](https://github.com/scalableminds/webknossos/pull/7922)
- It is now saved whether segment groups are collapsed or expanded, so this information doesn't get lost e.g. upon page reload. [#7928](https://github.com/scalableminds/webknossos/pull/7928/)
- The context menu entry "Focus in Segment List" expands all necessary segment groups in the segments tab to show the highlighted segment. [#7950](https://github.com/scalableminds/webknossos/pull/7950)
- In the proofreading mode, you can enable/disable that only the active segment and the hovered segment are rendered. [#7654](https://github.com/scalableminds/webknossos/pull/7654)
- Upgraded s3 client for improved performance when loading remote datasets. [#7936](https://github.com/scalableminds/webknossos/pull/7936)

### Changed
- The warning about a mismatch between the scale of a pre-computed mesh and the dataset scale's factor now also considers all supported mags of the active segmentation layer. This reduces the false posive rate regarding this warning. [#7921](https://github.com/scalableminds/webknossos/pull/7921/)
- It is no longer allowed to edit annotations of other organizations, even if they are set to public and to others-may-edit. [#7923](https://github.com/scalableminds/webknossos/pull/7923)
- When proofreading segmentations, the user can now interact with super-voxels directly in the data viewports. Additionally, proofreading is significantly faster because the segmentation data doesn't have to be re-downloaded after each merge/split operation. [#7654](https://github.com/scalableminds/webknossos/pull/7654)

### Fixed
- Fixed a bug that allowed the default newly created bounding box to appear outside the dataset. In case the whole bounding box would be outside it is created regardless. [#7892](https://github.com/scalableminds/webknossos/pull/7892)
- Fixed a rare bug that could cause hanging dataset uploads. [#7932](https://github.com/scalableminds/webknossos/pull/7932)
- Fixed that trashcan icons to remove layers during remote dataset upload were floating above the navbar. [#7954](https://github.com/scalableminds/webknossos/pull/7954)

### Removed

### Breaking Changes
