# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.0...HEAD)

### Added
- In addition to drag and drop, the selected tree(s) in the Skeleton tab can also be moved into another group by right-clicking the target group and selecting "Move selected tree(s) here". [#7005](https://github.com/scalableminds/webknossos/pull/7005)

### Changed

### Fixed
- Fixed that changing a segment color could lead to a crash. [#7000](https://github.com/scalableminds/webknossos/pull/7000)
- Fixed rendering issues on some affected systems that led to "black holes". [#7018](https://github.com/scalableminds/webknossos/pull/7018)
- Fixed a bug that made downloads of public annotations fail occasionally. [#7025](https://github.com/scalableminds/webknossos/pull/7025)

### Removed
- Support for [webknososs-connect](https://github.com/scalableminds/webknossos-connect) data store servers has been removed. Please remove the database entries for such datastores and the corresponding datasets and annotations. If you need to keep the datasets, consider adding them to a regular datastore using the same name. If the webknossos datastore does not support the dataset format, it may make sense to manually move the datasets to an existing datastore in the database, to avoid breaking foreign key relations. They will then be shown as “no longer available on the datastore”.

### Breaking Changes
