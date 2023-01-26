# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.01.0...HEAD)

### Added
- The target folder of a dataset can now be specified during upload. Also, clicking "Add Dataset" from an active folder will upload the dataset to that folder by default. [#6704](https://github.com/scalableminds/webknossos/pull/6704)
- The storage used by an organization’s datasets can now be measured. [#6685](https://github.com/scalableminds/webknossos/pull/6685)
- Precomputed meshes can now be loaded even when a mapping is active (HDF5 or an editable mapping produced by the proofreading tool). The precomputed mesh has to be computed without a mapping for this to work. [#6569](https://github.com/scalableminds/webknossos/pull/6569)

### Changed
- For remote datasets that require authentication, credentials are no longer stored in the respective JSON. [#6646](https://github.com/scalableminds/webknossos/pull/6646)
- Improved performance of opening a dataset or annotation. [#6711](https://github.com/scalableminds/webknossos/pull/6711)
- Redesigned organization page to include more infos on organization users, storage, webKnossos plan and provided opportunities to upgrade. [#6602](https://github.com/scalableminds/webknossos/pull/6602)
- Changed branding of WEBKNOSSOS including a new logo, new primary colors, and UPPERCASE name. [#6739](https://github.com/scalableminds/webknossos/pull/6739)
- Improves performance for ingesting Voxelytics reporting data. [#6732](https://github.com/scalableminds/webknossos/pull/6732)
- Implements statistics from combined worflow runs in the Voxelytics reporting. [#6732](https://github.com/scalableminds/webknossos/pull/6732)
- Limit paid task/project management features to respective organization plans. [6767](https://github.com/scalableminds/webknossos/pull/6767)
- The dataset list route `GET api/datasets` no longer respects the isEditable filter. [#6759](https://github.com/scalableminds/webknossos/pull/6759)

### Fixed
- Fixed node selection and context menu for node ids greater than 130813. [#6724](https://github.com/scalableminds/webknossos/pull/6724) and [#6731](https://github.com/scalableminds/webknossos/pull/6731)
- Fixed the validation of some neuroglancer URLs during import. [#6722](https://github.com/scalableminds/webknossos/pull/6722)
- Fixed a bug where deleting a dataset would fail if its representation on disk was already missing. [#6720](https://github.com/scalableminds/webknossos/pull/6720)
- Fixed a bug where a user with multiple organizations could not log in anymore after one of their organization accounts got deactivated. [#6719](https://github.com/scalableminds/webknossos/pull/6719)
- Fixed rare crash in new Datasets tab in dashboard. [#6750](https://github.com/scalableminds/webknossos/pull/6750) and [#6753](https://github.com/scalableminds/webknossos/pull/6753)
- Fixed toggling "Render missing data black" when being logged out. [#6772](https://github.com/scalableminds/webknossos/pull/6772)
- Fixed incorrect loading of precomputed meshes from mesh files that were computed for a specific mapping. [#6771](https://github.com/scalableminds/webknossos/pull/6771)
- Fixed a bug where remote datasets without authentication could not be explored. [#6764](https://github.com/scalableminds/webknossos/pull/6764)
- Fixed deprecation warnings for antd <Modal> props. [#6765](https://github.com/scalableminds/webknossos/pull/6765)
- Fixed a bug where direct task assignment to a single user would fail. [#6777](https://github.com/scalableminds/webknossos/pull/6777)
- Fixed a bug where the dataset folders view would not list public datasets if the requesting user could not also access the dataset for other reasons, like being admin. [#6759](https://github.com/scalableminds/webknossos/pull/6759)
- Fixed a bug where zarr-streamed datasets would produce (very rare) rendering errors. [#6782](https://github.com/scalableminds/webknossos/pull/6782)
- Fixed a bug where publicly shared annotations were not viewable by users without an account. [#6784](https://github.com/scalableminds/webknossos/pull/6784)

### Removed

### Breaking Changes
- Changes the storage backend for Voxelytics logging from Elasticsearch to Loki. [#6770](https://github.com/scalableminds/webknossos/pull/6770)
- The dataset list route `GET api/datasets` no longer respects the isEditable filter. [#6759](https://github.com/scalableminds/webknossos/pull/6759)
