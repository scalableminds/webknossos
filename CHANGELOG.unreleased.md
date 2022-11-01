# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.1...HEAD)

### Added
- Turned successful dataset conversions into a clickable link. [#6583](https://github.com/scalableminds/webknossos/pull/6583)
- Button for switching organizations for Voxelytics workflows. [#6572](https://github.com/scalableminds/webknossos/pull/6572)
- Added ability to shuffle / set colors for a whole tree group. [#6586](https://github.com/scalableminds/webknossos/pull/6586)

### Changed
- The log viewer in the Voxelytics workflow reporting now uses a virtualized list. [#6579](https://github.com/scalableminds/webknossos/pull/6579)
- Node positions are always handled as integers. They have always been persisted as integers by the server, anyway, but the session in which a node was created handled the position as floating point in earlier versions. [#6589](https://github.com/scalableminds/webknossos/pull/6589)
- When merging annotations, bounding boxes are no longer duplicated. [#6576](https://github.com/scalableminds/webknossos/pull/6576)

### Fixed

### Removed

### Breaking Changes
