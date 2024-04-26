# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.04.0...HEAD)

### Added
- Creating and deleting edges is now possible with ctrl+(alt/shift)+leftclick in orthogonal, flight and oblique mode. Also, the flight and oblique modes allow selecting nodes with leftclick, creating new trees with 'c' and deleting the active node with 'del'. [#7678](https://github.com/scalableminds/webknossos/pull/7678)
- Added Typescript defintions for @scalableminds/prop-types package. [#7744](https://github.com/scalableminds/webknossos/pull/7744)
- Time Tracking now also works when editing other users’ shared annotations, and when editing proofreading annotations (a.k.a. editable mappings). [#7749](https://github.com/scalableminds/webknossos/pull/7749)
- Added Typescript definitions for react-remarkable package. [#7748](https://github.com/scalableminds/webknossos/pull/7748)
- Within the proofreading tool, the user can now interact with the super voxels of a mesh in the 3D viewport. For example, this allows to merge or cut super voxels from another. As before, the proofreading tool requires an agglomerate file. [#7742](https://github.com/scalableminds/webknossos/pull/7742)

### Changed
- Improved task list to sort tasks by project date, add option to expand all tasks at once and improve styling. [#7709](https://github.com/scalableminds/webknossos/pull/7709)
- Changed the time-tracking overview to show times spent in annotations and tasks and filter them by teams and projects. In the linked detail view, the tracked times can also be filtered by type (annotations or tasks) and project. [#7524](https://github.com/scalableminds/webknossos/pull/7524)
- The time tracking api route `/api/users/:id/loggedTime`, which is used by the webknossos-libs client, and groups the times by month, now uses UTC when determining month limits, rather than the server’s local timezone. [#7524](https://github.com/scalableminds/webknossos/pull/7524)
- Duplicated annotations are opened in a new browser tab. [#7724](https://github.com/scalableminds/webknossos/pull/7724)
- When proofreading segments and merging two segments, the segment item that doesn't exist anymore after the merge is automatically removed. [#7729](https://github.com/scalableminds/webknossos/pull/7729)
- Changed some internal APIs to use spelling dataset instead of dataSet. This requires all connected datastores to be the latest version. [#7690](https://github.com/scalableminds/webknossos/pull/7690)
- Toasts are shown until WEBKNOSSOS is running in the active browser tab again. Also, the content of most toasts that show errors or warnings is printed to the browser's console. [#7741](https://github.com/scalableminds/webknossos/pull/7741)
- Improved UI speed when editing the description of an annotation. [#7769](https://github.com/scalableminds/webknossos/pull/7769)
- Updated dataset animations to use the new meshing API. Animitation now support ad-hoc meshes and mappings. [#7692](https://github.com/scalableminds/webknossos/pull/7692) 


### Fixed
- Fixed that the Command modifier on MacOS wasn't treated correctly for some shortcuts. Also, instead of the Alt key, the ⌥ key is shown as a hint in the status bar on MacOS. [#7659](https://github.com/scalableminds/webknossos/pull/7659)
- Moving from the time tracking overview to its detail view, the selected user was not preselected in the next view. [#7722](https://github.com/scalableminds/webknossos/pull/7722)
- Fixed incorrect position of WEBKNOSSOS logo in screenshots. [#7726](https://github.com/scalableminds/webknossos/pull/7726)
- Fixed that invisible nodes could be selected when using the skeleton tool. [#7732](https://github.com/scalableminds/webknossos/pull/7732)
- Fixed a bug where users that have no team memberships were omitted from the user list. [#7721](https://github.com/scalableminds/webknossos/pull/7721)
- Added an appropriate placeholder to be rendered in case the timetracking overview is otherwise empty. [#7736](https://github.com/scalableminds/webknossos/pull/7736)
- The overflow menu in the layer settings tab for layers with long names can now be opened comfortably. [#7747](https://github.com/scalableminds/webknossos/pull/7747)
- Fixed a bug where segmentation data looked scrambled when reading uint32 segmentation layers with CompressedSegmentation codec. [#7757](https://github.com/scalableminds/webknossos/pull/7757)
- Fixed a bug when downsampling a volume annotation that previously had only a restricted magnification set. [#7759](https://github.com/scalableminds/webknossos/pull/7759)

### Removed
- Meshfiles with version 2 or older are no longer supported. Talk to us about support in converting your old meshfiles. [#7764](https://github.com/scalableminds/webknossos/pull/7764)

### Breaking Changes
- When merging two trees or segments, the active item will always "survive" the merge operation (the clicked item will be merged *into* the active one). This was not consistent for certain skeleton-based operations (i.e., merging skeletons with a shortcut and proofreading segmentations with agglomerate skeletons). [#7729](https://github.com/scalableminds/webknossos/pull/7729)
