# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.04.0...HEAD)

### Added
- Added a new "draw" mode for the skeleton tool. When enabled, one can rapidly create notes by keeping the left mouse button pressed and moving the cursor. [#8434](https://github.com/scalableminds/webknossos/pull/8434)
- Added the concept of "toolkits". By default, all tools are available to the user (as before), but one can select a specific toolkit to only see certain tools. Some toolkits also change the behavior of the tools. For example, the "Split Segments" toolkit (see below). [#8434](https://github.com/scalableminds/webknossos/pull/8434)
- Added a workflow for splitting segments. Select the "Split Segments" toolkit and create a bounding box in which you want to execute the split. Then, use the skeleton tool to place nodes on the boundary between two (merged) segments. The nodes will be used to construct a 3D surface. Finally, use the floodfill tool (enable 3D and bounding-box restriction) to relabel a part of the segment. the floodfill won't cross the 3D surface. [#8434](https://github.com/scalableminds/webknossos/pull/8434)
- Added more layer specific settings to the configurations included in sharing links. [#8539](https://github.com/scalableminds/webknossos/pull/8539)
- When uploading multiple NMLs at once, the description is now kept, if all NMLs with non-empty descriptions have the same description. [#8533](https://github.com/scalableminds/webknossos/pull/8533)

### Changed
- Updated E2E tests to use `vitest` framework instead of `ava`. [#8543](https://github.com/scalableminds/webknossos/pull/8543)
- Adjusted the names of custom model inference jobs and train model jobs to match the worker's naming. [#8524](https://github.com/scalableminds/webknossos/pull/8524)
- Updated screenshot tests to use `vitest` framework instead of `ava`. [#8553](https://github.com/scalableminds/webknossos/pull/8553)

### Fixed

### Removed
- The Annotation update route can no longer update the description of the annotation. Please set the description before uploading the annotation instead. You can still edit the description in the UI. [#8533](https://github.com/scalableminds/webknossos/pull/8533)

### Breaking Changes
