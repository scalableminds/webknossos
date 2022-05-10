# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.1...HEAD)

### Added

### Changed
- When creating a new annotation with a volume layer (without fallback) for a dataset which has an existing segmentation layer, the original segmentation layer is still listed (and viewable) in the left sidebar. Earlier versions simply hid the original segmentation layer. [#6186](https://github.com/scalableminds/webknossos/pull/6186)
- Changing the visibility of a layer within an annotation does not change the visibility of the layer when viewing the corresponding dataset. [#6186](https://github.com/scalableminds/webknossos/pull/6186)

### Fixed

### Removed

### Breaking Changes
