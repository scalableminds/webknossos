# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.06.0...HEAD)

### Added

### Changed

### Fixed
- Improved efficiency of saving bounding box related changes. [#8492](https://github.com/scalableminds/webknossos/pull/8492)
- Fixed regression which caused the import of trees (also of agglomerate skeletons) to crash if the annotation was not empty. [#8656](https://github.com/scalableminds/webknossos/pull/8656)
- When deleting a dataset, its caches are cleared, so that if a new dataset by the same name is uploaded afterwards, only new data is loaded. [#8638](https://github.com/scalableminds/webknossos/pull/8638)

### Removed

### Breaking Changes
