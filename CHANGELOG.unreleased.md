# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.01.0...HEAD)

### Added
- The target folder of a dataset can now be specified during upload. Also, clicking "Add Dataset" from an active folder will upload the dataset to that folder by default. [#6704](https://github.com/scalableminds/webknossos/pull/6704)

### Changed
- Improved performance of opening a dataset or annotation. [#6711](https://github.com/scalableminds/webknossos/pull/6711)
- Redesigned organization page to include more infos on organization users, storage, webKnossos plan and provided opportunities to upgrade. [#6602](https://github.com/scalableminds/webknossos/pull/6602)

### Fixed
- Fixed node selection and context menu for node ids greater than 130813. [#6724](https://github.com/scalableminds/webknossos/pull/6724)
- Fixed the validation of some neuroglancer URLs during import. [#6722](https://github.com/scalableminds/webknossos/pull/6722)
- Fixed a bug where deleting a dataset would fail if its representation on disk was already missing. [#6720](https://github.com/scalableminds/webknossos/pull/6720)
- Fixed a bug where a user with multiple organizations could not log in anymore after one of their organization accounts got deactivated. [#6719](https://github.com/scalableminds/webknossos/pull/6719)

### Removed

### Breaking Changes
