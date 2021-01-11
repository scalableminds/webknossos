# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.01.0...HEAD)

### Added
- Added the possibility to generate skeletons from an HDF5 agglomerate file mapping on-the-fly. With an activated agglomerate file mapping, use `Shift + Middle Mouse Click` to import a skeleton of the cell into the annotation. Alternatively, use the button in the segmentation tab to import a skeleton of the centered cell into the annotation.

### Changed
- Users can now join multiple organizations, admins can now invite users by email address, skipping the manual user activation step. [#4984](https://github.com/scalableminds/webknossos/4984)
- Dataset Manager role now additionally grants permission to create explorative annotations on all datasets. [#5037](https://github.com/scalableminds/webknossos/pull/5037)

### Fixed
- Fixed a bug where importing NMLs failed if they had unescaped greater-than signs inside of attributes. [#5003](https://github.com/scalableminds/webknossos/pull/5003)

### Removed
-
