# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.07.0...HEAD)

### Added
- Added a modal to the voxelytics workflow view that lists all artifacts with their file size and inode count. This helps identifying the largest artifacts to free disk space. [#7152](https://github.com/scalableminds/webknossos/pull/7152)
- In order to facilitate changing the brush size in the brush tool, buttons with preset brush sizes were added. These presets are user configurable by assigning the current brush size to any of the preset buttons. Additionally the preset brush sizes can be set with keyboard shortcuts. [#7101](https://github.com/scalableminds/webknossos/pull/7101)
- Added new graphics and restyled empty dashboards. [#7008](https://github.com/scalableminds/webknossos/pull/7008)
- Added warning when using WEBKNOSSOS in an outdated browser. [#7165](https://github.com/scalableminds/webknossos/pull/7165)
- Added a search feature for segments and segment groups. Listed segments/groups can be searched by id and name. [#7175](https://github.com/scalableminds/webknossos/pull/7175)
- Added support for transformations with thin plate splines. [#7131](https://github.com/scalableminds/webknossos/pull/7131)
- WEBKNOSSOS can now read S3 remote dataset credentials from environment variables `AWS_ACCESS_KEY_ID` and `AWS_SECRET_KEY`. Those will be used, if available, when accessing remote datasets for which no explicit credentials are supplied. [#7170](https://github.com/scalableminds/webknossos/pull/7170)
- Added security.txt according to [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116). The content is configurable and it can be disabled. [#7182](https://github.com/scalableminds/webknossos/pull/7182)
- Added tooltips to explain the task actions "Reset" and "Reset and Cancel". [#7201](https://github.com/scalableminds/webknossos/pull/7201)
- Added batch actions for segment groups, such as changing the color and loading or downloading all corresponding meshes. [#7164](https://github.com/scalableminds/webknossos/pull/7164).

### Changed
- Redesigned the info tab in the right-hand sidebar to be fit the new branding and design language. [#7110](https://github.com/scalableminds/webknossos/pull/7110)
- The proofreading tool is always visible now (even when disabled). [#7174](https://github.com/scalableminds/webknossos/pull/7174)
- Optimized processing of parallel requests (new thread pool configuration, asynchronous FossilDB client), improving performance and reducing idle waiting. [#7139](https://github.com/scalableminds/webknossos/pull/7139)
- Renamed "open" tasks to "pending" and slightly redesigned the available task assignment view for clarity. [#7187](https://github.com/scalableminds/webknossos/pull/7187)

### Fixed
- Fixed rare rendering bug at viewport edge for anisotropic datasets. [#7163](https://github.com/scalableminds/webknossos/pull/7163)
- Fixed the dataset search which was broken when only the root folder existed. [#7177](https://github.com/scalableminds/webknossos/pull/7177)
- Correctly use configured fill-value for missing chunks of remote datasets hosted on gcs or s3. [#7198](https://github.com/scalableminds/webknossos/pull/7198)

### Removed
- Removed the "Globalize Floodfill" feature that could extend partial floodfills across an entire dataset. Please use the fill tool multiple times instead or make use of the proofreading tool when correcting large structures. [#7173](https://github.com/scalableminds/webknossos/pull/7173)

### Breaking Changes
