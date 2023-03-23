# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.03.0...HEAD)

### Added
- Added support for remote Zarr datasets with a `datasource-properties.json` as created by the WEBKNOSSOS Python library. [#6879](https://github.com/scalableminds/webknossos/pull/6879)

### Changed
- Uploads are now blocked when the organization’s storage quota is exceeded. [#6893](https://github.com/scalableminds/webknossos/pull/6893)

### Fixed

### Removed

### Breaking Changes
