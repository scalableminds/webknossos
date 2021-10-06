# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.08.0...HEAD)

### Added
- Added a rudimentary version of openAPI docs for some routes. Available at `/swagger.json`. [#5693](https://github.com/scalableminds/webknossos/pull/5693)
- Added support for datasets that have multiple segmentation layers. Note that only one segmentation layer can be rendered at a time, currently. [#5683](https://github.com/scalableminds/webknossos/pull/5683)
- Added shortcuts K and L for toggling the left and right sidebars. [#5709](https://github.com/scalableminds/webknossos/pull/5709)
- Added the possibility to load the skeletons of specific agglomerates from an agglomerate file when opening a tracing by including a mapping and agglomerate ids in the URL hash. See the [docs](https://docs.webknossos.org/webknossos/sharing.html#sharing-link-format) for further information. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
- Added a skeleton sandbox mode where a dataset can be opened and all skeleton tracing capabilities are available. However, by default changes are not saved. At any point, users can decide to copy the current state to their account. The sandbox can be accessed at `<webknossos_host>/datasets/<organization>/<dataset>/sandbox/skeleton`. In the combination with the new agglomerate skeleton loading feature this can be used to craft links that open webknossos with an activated mapping and specific agglomerates loaded on-demand. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
- The active mapping is now included in the link copied from the "Share" modal or the new "Share" button next to the dataset position. It is automatically activated for users that open the shared link. [#5738](https://github.com/scalableminds/webknossos/pull/5738)

### Changed
- By default, if data is missing in one magnification, higher magnifications are used for rendering. This setting can be controlled via the left sidebar under "Render Missing Data Black". [#5703](https://github.com/scalableminds/webknossos/pull/5703)
- Refactor the format of the URL hash/fragment to alternatively use JSON. Old links will continue to work. [#5730](https://github.com/scalableminds/webknossos/pull/5730)


### Fixed
- Fixed a bug where existing tasktypes with recommended configurations still had a property that is no longer valid. [#5707](https://github.com/scalableminds/webknossos/pull/5707)
- Fixed that segment IDs could not be copied to the clipboard. [#5709](https://github.com/scalableminds/webknossos/pull/5709)
- Fixed a bug where volume annotation version restore skipped buckets that were not yet touched in the version to be restored. [#5717](https://github.com/scalableminds/webknossos/pull/5717)
- Fixed a rendering bug showing non-existant or wrongly-colored edges that sometimes occurred after deleting edges, nodes, or trees. [#5724](https://github.com/scalableminds/webknossos/pull/5724)

### Removed
-

### Breaking Change
-
