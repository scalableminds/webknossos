# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.3...HEAD)

### Added
- Added support for storing analytics events in the Postgres. [#7594](https://github.com/scalableminds/webknossos/pull/7594) [#7609](https://github.com/scalableminds/webknossos/pull/7609)
- Segment statistics are now available for ND datasets. [#7411](https://github.com/scalableminds/webknossos/pull/7411)
- Added support for uploading N5 and Neuroglancer Precomputed datasets. [#7578](https://github.com/scalableminds/webknossos/pull/7578)
- Webknossos can now open ND Zarr datasets with arbitrary axis orders (not limited to `**xyz` anymore). [#7592](https://github.com/scalableminds/webknossos/pull/7592)
<<<<<<< HEAD
- You can now place segment index files with your on-disk segmentation layers, which makes segment stats available when viewing these segmentations, and also when working on volume annotations based on these segmentation layers. [#7437](https://github.com/scalableminds/webknossos/pull/7437)
=======
- Added a new "Split from all neighboring segments" feature for the proofreading mode. [#7611](https://github.com/scalableminds/webknossos/pull/7611)
>>>>>>> master

### Changed
- Datasets stored in WKW format are no longer loaded with memory mapping, reducing memory demands. [#7528](https://github.com/scalableminds/webknossos/pull/7528)
- Content Security Policy (CSP) settings are now relaxed by default. To keep stricter CSP rules, add them to your specific `application.conf`. [#7589](https://github.com/scalableminds/webknossos/pull/7589)
- WEBKNOSSOS now uses Java 21. [#7599](https://github.com/scalableminds/webknossos/pull/7599)
- Email verification is disabled by default. To enable it, set `webKnossos.user.emailVerification.activated` to `true` in your `application.conf`. [#7620](https://github.com/scalableminds/webknossos/pull/7620) [#7621](https://github.com/scalableminds/webknossos/pull/7621)
- Added more documentation for N5 and Neuroglancer precomputed web upload. [#7622](https://github.com/scalableminds/webknossos/pull/7622)
- Added the config key `webKnossos.user.timeTrackingOnlyWithSignificantChanges`, which when set to `true` will only track time if the user has made significant changes to the annotation. [#7627](https://github.com/scalableminds/webknossos/pull/7627)
- Only display UI elements to launch background jobs if the (worker) backend actually supports them. [#7591](https://github.com/scalableminds/webknossos/pull/7591)

### Fixed
- Fixed rare SIGBUS crashes of the datastore module that were caused by memory mapping on unstable file systems. [#7528](https://github.com/scalableminds/webknossos/pull/7528)
- Fixed loading local datasets for organizations that have spaces in their names. [#7593](https://github.com/scalableminds/webknossos/pull/7593)
- Fixed a bug where proofreading annotations would stay black until the next server restart due to expired but cached tokens. [#7598](https://github.com/scalableminds/webknossos/pull/7598)
- Fixed a bug where ad-hoc meshing didn't make use of a segment index, even when it existed. [#7600](https://github.com/scalableminds/webknossos/pull/7600)
- Fixed a bug where importing remote datasets with existing datasource-properties.jsons would not properly register the remote credentials. [#7601](https://github.com/scalableminds/webknossos/pull/7601)
- Fixed a bug in ND volume annotation downloads where the additionalAxes metadata had wrong indices. [#7592](https://github.com/scalableminds/webknossos/pull/7592)
- Fixed a bug in proofreading aka editable mapping annotations where splitting would sometimes give the new id to the selected segment rather than to the split-off one. [#7608](https://github.com/scalableminds/webknossos/pull/7608)
- Fixed small styling errors as a follow-up to the antd v5 upgrade. [#7612](https://github.com/scalableminds/webknossos/pull/7612)
- Fixed that the iOS keyboard automatically showed up when moving through a dataset. [#7660](https://github.com/scalableminds/webknossos/pull/7660)
- Fixed deprecation warnings caused by Antd \<Collapse\> components. [#7610](https://github.com/scalableminds/webknossos/pull/7610)
- Fixed small styling error with a welcome notification for new users on webknossos.org. [#7623](https://github.com/scalableminds/webknossos/pull/7623)
- Fixed that filtering by tags could produce false positives. [#7640](https://github.com/scalableminds/webknossos/pull/7640)
- Fixed a slight offset when creating a node with the mouse. [#7639](https://github.com/scalableminds/webknossos/pull/7639)
- Fixed small styling error with NML drag and drop uploading. [#7641](https://github.com/scalableminds/webknossos/pull/7641)
- Fixed a bug where the annotation list would show teams the annotation is shared with multiple times. [#7659](https://github.com/scalableminds/webknossos/pull/7659)

### Removed

### Breaking Changes
- Updated antd UI library from version 4.24.15 to 5.13.2. Drop support for nodeJs version <18. [#7522](https://github.com/scalableminds/webknossos/pull/7522)
