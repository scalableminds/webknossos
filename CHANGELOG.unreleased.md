# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased

[Commits](https://github.com/scalableminds/webknossos/compare/22.06.0...HEAD)

### Added

- Added a image data download speed indicator to the statusbar. On hover a tooltip is shown that show the total amount of downloaded shard data. [#6269](https://github.com/scalableminds/webknossos/pull/6269)
- Added a warning for when the resolution in the XY viewport on z=1-downsampled datasets becomes too low, explaining the problem and how to mitigate it. [#6255](https://github.com/scalableminds/webknossos/pull/6255)

### Changed

- For the api routes that return annotation info objects, the user field was renamed to owner. User still exists as an alias, but will be removed in a future release. [#6250](https://github.com/scalableminds/webknossos/pull/6250)
- Slimmed the URLs for annotations by removing `Explorational` and `Task`. The old URLs are still supported, but will be redirected to the new format. [#6208](https://github.com/scalableminds/webknossos/pull/6208)
- When creating a task from a base annotation, the starting position/rotation and bounding box as specified during task creation are now used and overwrite the ones from the original base annotation. [#6249](https://github.com/scalableminds/webknossos/pull/6249)

### Fixed

- Fixed that the context menu broke webKnossos when opening it in dataset-view-mode while no segmentation layer was visible. [#6259](https://github.com/scalableminds/webknossos/pull/6259)
- Fixed benign error toast when viewing a public annotation without being logged in. [#6271](https://github.com/scalableminds/webknossos/pull/6271)

### Removed

### Breaking Changes
