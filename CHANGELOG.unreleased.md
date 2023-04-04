# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.04.0...HEAD)

### Added
- Added rendering precomputed meshes with level of detail depending on the zoom of the 3D viewport. This feature only works with version 3 mesh files. [#6909](https://github.com/scalableminds/webknossos/pull/6909)
- Segments can now be removed from the segment list via the context menu. [#6944](https://github.com/scalableminds/webknossos/pull/6944)
- Editing the meta data of segments (e.g., the name) is now undoable. [#6944](https://github.com/scalableminds/webknossos/pull/6944)

### Changed
- Moved the view mode selection in the toolbar next to the position field. [#6949](https://github.com/scalableminds/webknossos/pull/6949)
- Redesigned welcome toast for new, annonymous users with new branding. [#6961](https://github.com/scalableminds/webknossos/pull/6961)

### Fixed
- Fixed incorrect initial tab when clicking "Show Annotations" for a user in the user list. Also, the datasets tab was removed from that page as it was the same as the datasets table from the main dashboard. [#6957](https://github.com/scalableminds/webknossos/pull/6957)

### Removed

### Breaking Changes
