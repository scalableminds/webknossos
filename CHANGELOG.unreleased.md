# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.0...HEAD)

### Added

### Changed
- When creating or uploading a non-task volume annotation layer with a fallback segmentation layer, the annotation layer’s bounding box will now be limited to that layer’s, instead of the whole dataset’s. [#7580](https://github.com/scalableminds/webknossos/pull/7580)

### Fixed

### Removed

### Breaking Changes
