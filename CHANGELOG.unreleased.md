# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.11.0...HEAD)

### Added
- The total length of skeletons can now be measured using the dropdown in the tree list tab. Also, the frontend API received the methods `api.tracing.measureTreeLength` and `api.tracing.measureAllTrees`. [#4898](https://github.com/scalableminds/webknossos/pull/4898)
- Introduced an indeterminate visibility state for groups in the tree tab if not all but only some of the group's children are visible. Before, the visibility of those groups was shown as not visible which made it hard to find the visible trees. [#4897](https://github.com/scalableminds/webknossos/pull/4897)
- Dataset uploads on a specific Datastore can now be restricted to a single organization. [#4892](https://github.com/scalableminds/webknossos/pull/4892)
- Added multi-resolution volume annotations. Note that already existing volume tracings will still only contain data in the first magnification. If you want to migrate an old volume tracing, you can download and re-import it. [#4755](https://github.com/scalableminds/webknossos/pull/4755)

### Changed
- In the tree tab, all groups but the root group are now collapsed instead of expanded when opening a tracing. [#4897](https://github.com/scalableminds/webknossos/pull/4897)
- New volume/hybrid annotations are now automatically multi-resolution volume annotations. [#4755](https://github.com/scalableminds/webknossos/pull/4755)
- Improved performance of volume annotations (brush and trace tool). [#4848](https://github.com/scalableminds/webknossos/pull/4848)
- Re-enabled continuous brush strokes. This feature ensures that even fast brush strokes are continuous and don't have "holes". [#4924](https://github.com/scalableminds/webknossos/pull/4924)

### Fixed
- Fixed the disappearing of dataset settings after switching between view mode and annotation mode. [#4845](https://github.com/scalableminds/webknossos/pull/4845)
- Fixed a rare error in the agglomerate mapping for large datasets. [#4904](https://github.com/scalableminds/webknossos/pull/4904)
- Fixed a bug where in volume annotation zip upload some buckets were discarded. [#4914](https://github.com/scalableminds/webknossos/pull/4914)
- Fixed the Dataset import which was broken temporarily. [#4932](https://github.com/scalableminds/webknossos/pull/4932)

### Removed
-
