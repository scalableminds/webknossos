# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.06.1...HEAD)

### Added
- Added the ability to duplicate trees in skeleton annotations. Users can create a copy of any tree (including all nodes, edges, and properties) via the context menu in the skeleton tab. [#8662](https://github.com/scalableminds/webknossos/pull/8662)
- Meshes are now reloaded using their previous opacity value. [#8622](https://github.com/scalableminds/webknossos/pull/8622)

### Changed
- Before starting a neuron segmentation with `Evaluation Settings` enabled, it is checked that a useful bounding box was selected and that some skeletons exist within the annotation, preventing the job from failing. [#8678](https://github.com/scalableminds/webknossos/pull/8678)
- Before starting a neuron segmentation with `Evaluation Settings` enabled, it is checked that a useful bounding box was selected and that some skeletons exist within the annotation, preventing the job 
### Fixed
- Improved efficiency of saving bounding box related changes. [#8492](https://github.com/scalableminds/webknossos/pull/8492)
- When deleting a dataset, its caches are cleared, so that if a new dataset by the same name is uploaded afterwards, only new data is loaded. [#8638](https://github.com/scalableminds/webknossos/pull/8638)

### Removed

### Breaking Changes
