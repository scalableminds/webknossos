# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.04.0...HEAD)

### Added

### Changed
- When loading data from a data layer that has data stored beyond the bounding box specified in the datasource-properties.json, data outside of the bounding box is now zeroed. (the layer is “clipped”). [#8551](https://github.com/scalableminds/webknossos/pull/8551)

### Fixed

### Removed

### Breaking Changes
