# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.11.0...HEAD)

### Added
- Added a button to the search popover in the skeleton and segment tab to select all matching non-group results. [#8123](https://github.com/scalableminds/webknossos/pull/8123)
- Workflow reports may be deleted by superusers. [#8156](https://github.com/scalableminds/webknossos/pull/8156)

### Changed
- Thumbnails for datasets now use the selected mapping from the view configuration if available. [#8157](https://github.com/scalableminds/webknossos/pull/8157)

### Fixed
- Fixed bbox export menu item [#8152](https://github.com/scalableminds/webknossos/pull/8152)
- When trying to save an annotation opened via a link including a sharing token, the token is automatically discarded in case it is insufficient for update actions but the users token is. [#8139](https://github.com/scalableminds/webknossos/pull/8139)
- Fix that scrolling in the trees and segments tab did not work while dragging. [#8162](https://github.com/scalableminds/webknossos/pull/8162)
- Fixed that uploading a dataset which needs a conversion failed when the angstrom unit was configured for the conversion. [#8173](https://github.com/scalableminds/webknossos/pull/8173)
- Fixed downloading task annotations of teams you are not in, when accessing directly via URI. [#8155](https://github.com/scalableminds/webknossos/pull/8155)
- Removed unnecessary scrollbars in skeleton tab that occurred especially after resizing. [#8148](https://github.com/scalableminds/webknossos/pull/8148)
- Deleting a bounding box is now possible independently of a visible segmentation layer. [#8164](https://github.com/scalableminds/webknossos/pull/8164)
- S3-compliant object storages can now be accessed via HTTPS. [#8167](https://github.com/scalableminds/webknossos/pull/8167)
- Fixed a layout persistence bug leading to empty viewports, triggered when switching between orthogonal, flight, or oblique mode. [#8177](https://github.com/scalableminds/webknossos/pull/8177)

### Removed

### Breaking Changes
