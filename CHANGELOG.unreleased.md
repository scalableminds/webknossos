# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.08.0...HEAD)

### Added
- Datasets and annotations can now be more than 3-dimensional, using additional coordinates. [#7136](https://github.com/scalableminds/webknossos/pull/7136)
- Added the option to change the ordering of color layers via drag and drop. This is useful when using the cover blend mode. [#7188](https://github.com/scalableminds/webknossos/pull/7188)
- Added configuration to require users' emails to be verified, added flow to verify emails via link. [#7161](https://github.com/scalableminds/webknossos/pull/7161)
- Added a route to explore and add remote datasets via API. [#7176](https://github.com/scalableminds/webknossos/pull/7176)
- Added option to select multiple segments in the segment list in order to perform batch actions. [#7242](https://github.com/scalableminds/webknossos/pull/7242)

### Changed
- Small messages during annotating (e.g. “finished undo”, “applying mapping…”) are now click-through so they do not block users from selecting tools. [7239](https://github.com/scalableminds/webknossos/pull/7239)

### Fixed
- Fixed that folders could appear in the dataset search output in the dashboard. [#7232](https://github.com/scalableminds/webknossos/pull/7232)

### Removed

### Breaking Changes
