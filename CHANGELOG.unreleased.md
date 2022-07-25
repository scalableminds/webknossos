# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.08.0...HEAD)

### Added
- Segmentation layers which were not previously editable now show an (un)lock icon button which shortcuts to the Add Volume Layer modal with the layer being preselected. [#6330](https://github.com/scalableminds/webknossos/pull/6330)

### Changed
- The Layers tab now displays an Add Skeleton Annotation Layer button with which volume-only annotations can be converted to hybrid annotations. [#6330](https://github.com/scalableminds/webknossos/pull/6330)

### Fixed
- Fixed a regression where the mapping activation confirmation dialog was never shown. [#6346](https://github.com/scalableminds/webknossos/pull/6346)
- Fixed an error if multiple proofreading actions were performed in rapid succession. If webKnossos is busy, inputs to the viewports are disabled from now on. [#6325](https://github.com/scalableminds/webknossos/pull/6325)

### Removed
- Annotation Type was removed from the info tab. [#6330](https://github.com/scalableminds/webknossos/pull/6330)

### Breaking Changes
