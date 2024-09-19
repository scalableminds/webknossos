# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.08.1...HEAD)

### Added
- It is now possible to focus a bounding box in the bounding box tab by clicking its edges in a viewport or via a newly added context menu entry. [#8054](https://github.com/scalableminds/webknossos/pull/8054)
- Added the option to export nd datasets as ome tiff or tiff stack. Previously, this was only possible for 3d datasets. [#7971](https://github.com/scalableminds/webknossos/pull/7971)
- Added an assertion to the backend to ensure unique keys in the metadata info of datasets and folders. [#8068](https://github.com/scalableminds/webknossos/issues/8068)

### Changed
- Clicking on a bounding box within the bounding box tab centers it within the viewports and focusses it in the list. [#8049](https://github.com/scalableminds/webknossos/pull/8049)
- For self-hosted versions, the text in the data set upload view was updated to recommend switching to webknossos.org. [#7996](https://github.com/scalableminds/webknossos/pull/7996)
- Updated frontend package management to yarn version 4. [8061](https://github.com/scalableminds/webknossos/pull/8061)
- Updated React to version 18. Updated many peer dependencies inlcuding Redux, React-Router, antd, and FlexLayout. [#8048](https://github.com/scalableminds/webknossos/pull/8048)
- Improved the performance of context menus in the bounding box tab. [#8059](https://github.com/scalableminds/webknossos/pull/8059)

### Fixed
- The JS API v2 has been removed as it was deprecated by v3 in 2018. Please upgrade to v3 in case your scripts still use v2. [#8076](https://github.com/scalableminds/webknossos/pull/8076)
- Fixed that the precompute-meshfile button did not work in the segments tab. [#8077](https://github.com/scalableminds/webknossos/pull/8077)

### Removed

### Breaking Changes
