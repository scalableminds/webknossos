# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.02.0...HEAD)

### Added
- The "Meshes" tab was overhauled, so that it displays generated isosurfaces and imported meshes. Generated isosurfaces can be jumped to, reloaded, downloaded and removed. [#4917](https://github.com/scalableminds/webknossos/pull/4917)
- Added an explicit `/signup` (or `/auth/signup`) route. [#5091](https://github.com/scalableminds/webknossos/pull/5091/files)

### Changed
- Make the isosurface feature in the meshes tab more robust. If a request fails, a retry is initiated. [#5102](https://github.com/scalableminds/webknossos/pull/5102)
- Support for the old invite links was removed. These contained the organization name in the URL. The new links contain a token (can be generated in the users view). For instances with a single organization the old invite links should still work. [#5091](https://github.com/scalableminds/webknossos/pull/5091/files)
- Users are no longer allowed to deactivate their own accounts.  [#5070](https://github.com/scalableminds/webknossos/pull/5070)
- A user needs to confirm his choice if he really wants to leave the dataset upload view while it's still loading. [#5051](https://github.com/scalableminds/webknossos/pull/5049)
- Mailer now uses only TLS1.2 instead of JDK default. [#5138](https://github.com/scalableminds/webknossos/pull/5138)

### Fixed
- Fixed a bug where the user could delete teams that were still referenced in annotations, projects or task types, thus creating invalid state. [#5108](https://github.com/scalableminds/webknossos/pull/5108/files)
- Fixed a bug where the listing of users that have open tasks of a project failed. [#5115](https://github.com/scalableminds/webknossos/pull/5115)

### Removed
- Support for KNOSSOS cubes data format was removed. Use the [webKnossos cuber](https://github.com/scalableminds/webknossos-cuber) tool to convert existing datasets saved as KNOSSOS cubes. [#5085](https://github.com/scalableminds/webknossos/pull/5085)
- The isosurface setting was removed. Instead, isosurfaces can be generated via the "Meshes" tab. Also note that the Shift+Click binding for generating an isosurface was removed (for now). Please refer to the "Meshes" tab, too. [#4917](https://github.com/scalableminds/webknossos/pull/4917)
