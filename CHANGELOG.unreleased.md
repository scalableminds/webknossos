# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.2...HEAD)

### Added
- Added a new Quick-Select tool for volume annotation. This tools allows to draw a rectangle over a segment to annotate it automatically. The tool operates on the intensity data of the visible color layer and automatically fills out the segment starting from the center of the rectangle. Next to the tool, there is a settings button which allows to enable a preview mode and to tweak some other parameters. If the preview is enabled, the parameters can be fine-tuned while the preview updates instantly. [#6542](https://github.com/scalableminds/webknossos/pull/6542)
- The largest segment id for a segmentation layer can be computed automatically from the dataset settings page. [#6415](https://github.com/scalableminds/webknossos/pull/6415)
- Button for switching organizations for Voxelytics workflows. [#6572](https://github.com/scalableminds/webknossos/pull/6572)
- Added ability to shuffle / set colors for a whole tree group. [#6586](https://github.com/scalableminds/webknossos/pull/6586)
- Annotation layers can now be removed. [#6593](https://github.com/scalableminds/webknossos/pull/6593)
- When adding remote Zarr datasets with multiple channels, channels are converted into layers. [#6609](https://github.com/scalableminds/webknossos/pull/6609)
- When adding a remote OME-NGFF dataset with labels, these are added as segmentation layers. [#6638](https://github.com/scalableminds/webknossos/pull/6638)
- The scale bar is now included in screenshots of the viewports made using the `Q` shortcut or the "Screenshot" menu entry. If the scale bar should not be included, disable it using "Settings - Viewport Options - Show Scalebars". [#6644](https://github.com/scalableminds/webknossos/pull/6644)
- When creating an annotation from the dataset view, a previously selected mapping of the segmentation layer is now automatically selected in the volume annotation layer fallback segmentation as well. [#6647](https://github.com/scalableminds/webknossos/pull/6647)

### Changed
- The log viewer in the Voxelytics workflow reporting now uses a virtualized list. [#6579](https://github.com/scalableminds/webknossos/pull/6579)
- Node positions are always handled as integers. They have always been persisted as integers by the server, anyway, but the session in which a node was created handled the position as floating point in earlier versions. [#6589](https://github.com/scalableminds/webknossos/pull/6589)
- Jobs can no longer be started on datastores without workers. [#6595](https://github.com/scalableminds/webknossos/pull/6595)
- When downloading volume annotations with volume data skipped, the nml volume tag is now included anyway (but has no location attribute in this case). [#6566](https://github.com/scalableminds/webknossos/pull/6566)
- Re-phrased some backend (error) messages to improve clarity and provide helping hints. [#6616](https://github.com/scalableminds/webknossos/pull/6616)
- The layer visibility is now encoded in the sharing link. The user opening the link will see the same layers that were visible when copying the link. [#6634](https://github.com/scalableminds/webknossos/pull/6634)
- Voxelytics workflows can now be viewed by anyone with the link who is in the right organization. [#6622](https://github.com/scalableminds/webknossos/pull/6622)
- Improve performance for handling of volume annotation data (saving/undo/redo). [#6652](https://github.com/scalableminds/webknossos/pull/6652)
- When importing an annotation into an existing annotation, webKnossos ensures that bounding boxes are not duplicated in case they exist in the current *and* imported annotation. [#6648](https://github.com/scalableminds/webknossos/pull/6648)
- Reworked the proofreading mode so that agglomerate skeletons are no longer needed (nor automatically loaded). Instead, segments can be selected by left-clicking onto them, indicated by a small white cross. To merge or split agglomerates, then either use the shortcuts `Shift + Leftclick`/`Ctrl + Leftclick` or use the context menu. [#6625](https://github.com/scalableminds/webknossos/pull/6625)
 
### Fixed
- Fixed a bug in the dataset import view, where the layer name text field would lose focus after each key press. [#6615](https://github.com/scalableminds/webknossos/pull/6615)
- Fixed importing NGFF Zarr datasets with non-scale transforms. [#6621](https://github.com/scalableminds/webknossos/pull/6621)
- Fixed a regression in NGFF Zarr import for datasets with no channel axis. [#6636](https://github.com/scalableminds/webknossos/pull/6636
- Fixed broken creation of tasks using base NMLs. [#6634](https://github.com/scalableminds/webknossos/pull/6634)
- Fixed that the precomputation of meshes didn't take the active mapping into account. [#6651](https://github.com/scalableminds/webknossos/pull/6651)

### Removed

### Breaking Changes
