# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.01.0...HEAD)

### Added
- Added the possibility to generate skeletons from an HDF5 agglomerate file mapping on-the-fly. With an activated agglomerate file mapping, use `Shift + Middle Mouse Click` to import a skeleton of the cell into the annotation. Alternatively, use the button in the segmentation tab to import a skeleton of the centered cell into the annotation. [#4958](https://github.com/scalableminds/webknossos/pull/4958)
- Added a cleanup procedure for erroneous uploads, so failed uploads can be retried without changing the dataset name. [#4999](https://github.com/scalableminds/webknossos/pull/4999)

### Changed
- The brush tool is disabled in low magnifications (magnification 16 and lower) to avoid performance problems when annotating. [#5017](https://github.com/scalableminds/webknossos/pull/5017)
- Users can now join multiple organizations, admins can now invite users by email address, skipping the manual user activation step. [#4984](https://github.com/scalableminds/webknossos/4984)
- Dataset Manager role now additionally grants permission to create explorative annotations on all datasets. [#5037](https://github.com/scalableminds/webknossos/pull/5037)
- A user needs to confirm his choice if he really wants to leave the dataset upload view while it's still loading. [#5051](https://github.com/scalableminds/webknossos/pull/5049)

### Fixed
- Fixed a bug where importing NMLs failed if they had unescaped greater-than signs inside of attributes. [#5003](https://github.com/scalableminds/webknossos/pull/5003)
- Mitigate errors concerning localStorage quotas in the datasets dashboard. [#5039](https://github.com/scalableminds/webknossos/pull/5039)
- Fixed a bug where viewing a dataset via sharingToken crashed. [#5047](https://github.com/scalableminds/webknossos/pull/5047)

### Removed
-
