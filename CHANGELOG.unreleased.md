# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.09.0...HEAD)

### Added
- Enhanced the volume fill tool to so that it operates beyond the dimensions of the current viewport. Additionally, the fill tool can also be changed to perform in 3D instead of 2D. [#5733](https://github.com/scalableminds/webknossos/pull/5733)
- Added the possibility to load the skeletons of specific agglomerates from an agglomerate file when opening a tracing by including a mapping and agglomerate ids in the URL hash. See the [docs](https://docs.webknossos.org/webknossos/sharing.html#sharing-link-format) for further information. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
- Added a skeleton sandbox mode where a dataset can be opened and all skeleton tracing capabilities are available. However, by default changes are not saved. At any point, users can decide to copy the current state to their account. The sandbox can be accessed at `<webknossos_host>/datasets/<organization>/<dataset>/sandbox/skeleton`. In the combination with the new agglomerate skeleton loading feature this can be used to craft links that open webknossos with an activated mapping and specific agglomerates loaded on-demand. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
- The active mapping is now included in the link copied from the "Share" modal or the new "Share" button next to the dataset position. It is automatically activated for users that open the shared link. [#5738](https://github.com/scalableminds/webknossos/pull/5738)

### Changed
-

### Fixed
- Fixed two volume tracing related bugs which could occur when using undo with a slow internet connection or when volume-annotating more than 5000 buckets (32**3 vx) in one session. [#5728](https://github.com/scalableminds/webknossos/pull/5728)
- Jobs status is no longer polled if jobs are not enabled, avoiding backend logging spam [#5761](https://github.com/scalableminds/webknossos/pull/5761)
- Fixed a bug that windows user could not open the context menu as it instantly closed after opening. [#5756](https://github.com/scalableminds/webknossos/pull/5756).
- Fixed a bug where the health check of public datasets failed if no cookie/token was supplied. [#5768](https://github.com/scalableminds/webknossos/pull/5768).
- Fixed a bug where retried save requests could lead to a 409 CONFLICT error if the first request was already handled by the back-end. [#5779](https://github.com/scalableminds/webknossos/pull/5779).
- Fixed a bug where volume annotations could not be saved under certain circumstances (if "Render Missing Data Black" was disabled and a data bucket was annotated for the first time). [#5783](https://github.com/scalableminds/webknossos/pull/5783)

### Removed
-

### Breaking Change
-
