# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.0...HEAD)

### Added
- Added support for storing analytics events in the Postgres. [#7594](https://github.com/scalableminds/webknossos/pull/7594) 

### Changed
- Datasets stored in WKW format are no longer loaded with memory mapping, reducing memory demands. [#7528](https://github.com/scalableminds/webknossos/pull/7528)

### Fixed
- Fixed rare SIGBUS crashes of the datastore module that were caused by memory mapping on unstable file systems. [#7528](https://github.com/scalableminds/webknossos/pull/7528)
- Fixed loading local datasets for organizations that have spaces in their names. [#7593](https://github.com/scalableminds/webknossos/pull/7593)
- Fixed a bug where proofreading annotations would stay black until the next server restart due to expired but cached tokens. [#7598](https://github.com/scalableminds/webknossos/pull/7598)
- Fixed a bug where ad-hoc meshing didn't make use of a segment index, even when it existed. [#7600](https://github.com/scalableminds/webknossos/pull/7600)
- Fixed a bug where importing remote datasets with existing datasource-properties.jsons would not properly register the remote credentials. [#7601](https://github.com/scalableminds/webknossos/pull/7601)

### Removed

### Breaking Changes
