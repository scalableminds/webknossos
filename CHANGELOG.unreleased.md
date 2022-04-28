# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.0...HEAD)

### Added
- Added Volume Interpolation feature. When enabled, it suffices to only label every 2nd slice. The skipped slices will be filled automatically by interpolating between the labeled slices. The little arrow indicates whether you are currently labeling with increasing or decreasing X/Y/Z. This feature is disabled by default (and also forbidden by default for tasks). [#6162](https://github.com/scalableminds/webknossos/pull/6162)

### Changed
- The mouse cursor now changes appearance to indicate the currently selected annotation tool  [#6132](https://github.com/scalableminds/webknossos/pull/6132)
- Changed default of `dynamicSpaceDirection` property to false to avoid confusion. [#6162](https://github.com/scalableminds/webknossos/pull/6162)

### Fixed
- Fixed applying recommended settings when starting a task which provides recommended settings. [#6175](https://github.com/scalableminds/webknossos/pull/6175)

### Removed
 - Removed the option to download sample-datasets. To explore webKnossos, use the public sample datasets on webknossos.org. [#6151](https://github.com/scalableminds/webknossos/pull/6151)

### Breaking Changes
