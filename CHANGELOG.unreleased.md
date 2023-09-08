# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.09.0...HEAD)

### Added
- Datasets and annotations can now be more than 3-dimensional, using additional coordinates. [#7136](https://github.com/scalableminds/webknossos/pull/7136)
- Added disabled drag handles to volume and skeleton layers for visual consistency. These layer cannot be dragged or reordered. [#7295](https://github.com/scalableminds/webknossos/pull/7295)
- Dataset thumbnails for grayscale layers can now be colored using the value in the view configuration. [#7255](https://github.com/scalableminds/webknossos/pull/7255)
- OpenID Connect authorization is now compatible with Providers that send the user information in an id_token. [#7294](https://github.com/scalableminds/webknossos/pull/7294)
- The AI-based quick select tool can now also be used for ND datasets. [#7287](https://github.com/scalableminds/webknossos/pull/7287)

### Changed
- Annotating volume data uses a transaction-based mechanism now. As a result, WK is more robust against partial saves (i.e., due to a crashing tab). [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Improved speed of saving volume data. [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Improved progress indicator when saving volume data. [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Adapted Zarr 3 implementations to recent changes in the specification (index codecs, zstd codec). [#7305](https://github.com/scalableminds/webknossos/pull/7305)

### Fixed
- Fixed that the deletion of a selected segment would crash the segments tab. [#7316](https://github.com/scalableminds/webknossos/pull/7316)
- Fixed reading sharded Zarr 3 data from the local file system. [#7321](https://github.com/scalableminds/webknossos/pull/7321)
- Fixed no-bucket data zipfile when downloading volume annotations. [#7323](https://github.com/scalableminds/webknossos/pull/7323)
- Fixed too tight assertions when saving annotations, leading to failed save requests. [#7326](https://github.com/scalableminds/webknossos/pull/7326)

### Removed

### Breaking Changes
