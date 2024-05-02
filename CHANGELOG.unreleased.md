# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.05.0...HEAD)

### Added
- Within the proofreading tool, the user can now interact with the super voxels of a mesh in the 3D viewport. For example, this allows to merge or cut super voxels from another. As before, the proofreading tool requires an agglomerate file. [#7742](https://github.com/scalableminds/webknossos/pull/7742)

### Changed
- Non admin or manager user can no longer start long running jobs creating datasets. This includes annotation materialization and AI inferrals. [#7753](https://github.com/scalableminds/webknossos/pull/7753)

### Fixed

### Removed

### Breaking Changes
