# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.02.1...HEAD)

### Added
- Remote datasets can now also be streamed from Google Cloud Storage URIs (`gs://`). [#6775](https://github.com/scalableminds/webknossos/pull/6775)

### Changed
- Limit paid team sharing features to respective organization plans. [#6767](https://github.com/scalableminds/webknossos/pull/6776)
- Rewrite the database tools in `tools/postgres` to JavaScript and adding support for non-default Postgres username-password combinations. [#6803](https://github.com/scalableminds/webknossos/pull/6803)

### Fixed
- Fixed saving allowed teams in dataset settings [#6817](https://github.com/scalableminds/webknossos/pull/6817)

### Removed

### Breaking Changes
