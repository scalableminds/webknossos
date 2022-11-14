# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.1...HEAD)

### Added
- Added a new Quick-Select tool for volume annotation. This tools allows to draw a rectangle over a segment to annotate it automatically. The tool operates on the intensity data of the visible color layer and automatically fills out the segment starting from the center of the rectangle. Next to the tool, there is a settings button which allows to enable a preview mode and to tweak some other parameters. If the preview is enabled, the parameters can be fine-tuned while the preview updates instantly. [#6542](https://github.com/scalableminds/webknossos/pull/6542)
- The largest segment id for a segmentation layer can be computed automatically from the dataset settings page. [#6415](https://github.com/scalableminds/webknossos/pull/6415)
- Button for switching organizations for Voxelytics workflows. [#6572](https://github.com/scalableminds/webknossos/pull/6572)
- Added ability to shuffle / set colors for a whole tree group. [#6586](https://github.com/scalableminds/webknossos/pull/6586)
- Annotation layers can now be removed. [#6593](https://github.com/scalableminds/webknossos/pull/6593)
- When adding remote Zarr datasets with multiple channels, channels are converted into layers. [#6609](https://github.com/scalableminds/webknossos/pull/6609)

### Changed
- The log viewer in the Voxelytics workflow reporting now uses a virtualized list. [#6579](https://github.com/scalableminds/webknossos/pull/6579)
- Node positions are always handled as integers. They have always been persisted as integers by the server, anyway, but the session in which a node was created handled the position as floating point in earlier versions. [#6589](https://github.com/scalableminds/webknossos/pull/6589)
- When merging annotations, bounding boxes are no longer duplicated. [#6576](https://github.com/scalableminds/webknossos/pull/6576)
- Jobs can no longer be started on datastores without workers. [#6595](https://github.com/scalableminds/webknossos/pull/6595)
- When downloading volume annotations with volume data skipped, the nml volume tag is now included anyway (but has no location attribute in this case). [#6566](https://github.com/scalableminds/webknossos/pull/6566)
- Re-phrased some backend (error) messages to improve clarity and provide helping hints. [#6616](https://github.com/scalableminds/webknossos/pull/6616)
 
### Fixed
- Fixed importing a dataset from disk. [#6615](https://github.com/scalableminds/webknossos/pull/6615)
- Fixed a bug in the dataset import view, where the layer name text field would lose focus after each key press. [#6615](https://github.com/scalableminds/webknossos/pull/6615)
- Fixed importing NGFF Zarr datasets with non-scale transforms. [#6621](https://github.com/scalableminds/webknossos/pull/6621)
- Fixed a regression in NGFF Zarr import for datasets with no channel axis. [#6636](https://github.com/scalableminds/webknossos/pull/6636)<<<<<<< task-creation-nml
- Fixed broken creation of tasks using base NMLs. [#6634](https://github.com/scalableminds/webknossos/pull/6634)

### Removed

### Breaking Changes
