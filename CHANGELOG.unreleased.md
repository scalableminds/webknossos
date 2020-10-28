# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.11.0...HEAD)

### Added
- Introduced an indeterminate visibility state for groups in the tree tab if not all but only some of the group's children are visible. Before, the visibility of those groups was shown as not visible which made it hard to find the visible trees. [#4897](https://github.com/scalableminds/webknossos/pull/4897)
- Dataset uploads on a specific Datastore can now be restricted to a single organization. [#4892](https://github.com/scalableminds/webknossos/pull/4892)

### Changed
- In the tree tab, all groups but the root group are now collapsed instead of expanded when opening a tracing. [#4897](https://github.com/scalableminds/webknossos/pull/4897)

### Fixed
-

### Removed
-
