# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.09.0...HEAD)

### Added
- Added the possibility to load the skeletons of specific agglomerates from an agglomerate file when opening a tracing by including a mapping and agglomerate ids in the URL hash. See the [docs](https://docs.webknossos.org/webknossos/sharing.html#sharing-link-format) for further information. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
- Added a skeleton sandbox mode where a dataset can be opened and all skeleton tracing capabilities are available. However, by default changes are not saved. At any point, users can decide to copy the current state to their account. The sandbox can be accessed at `<webknossos_host>/datasets/<organization>/<dataset>/sandbox/skeleton`. In the combination with the new agglomerate skeleton loading feature this can be used to craft links that open webknossos with an activated mapping and specific agglomerates loaded on-demand. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
- The active mapping is now included in the link copied from the "Share" modal or the new "Share" button next to the dataset position. It is automatically activated for users that open the shared link. [#5738](https://github.com/scalableminds/webknossos/pull/5738)

### Changed
-

### Fixed
- Fixed a bug that windows user could not open the context menu as it instantly closed after opening. [#5756](https://github.com/scalableminds/webknossos/pull/5756).

### Removed
-

### Breaking Change
-
