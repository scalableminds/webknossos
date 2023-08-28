# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.08.0...HEAD)

### Added
- Added the option to change the ordering of color layers via drag and drop. This is useful when using the cover blend mode. [#7188](https://github.com/scalableminds/webknossos/pull/7188)
- Added configuration to require users' emails to be verified, added flow to verify emails via link. [#7161](https://github.com/scalableminds/webknossos/pull/7161)
- Added a route to explore and add remote datasets via API. [#7176](https://github.com/scalableminds/webknossos/pull/7176)
- Added a new button to the layer settings in view only dataset mode to save the current view configuration as the dataset's default. [#7205](https://github.com/scalableminds/webknossos/pull/7205)
- Added option to select multiple segments in the segment list in order to perform batch actions. [#7242](https://github.com/scalableminds/webknossos/pull/7242)
- If a dataset layer is transformed (using an affine matrix or a thin plate spline), it can be dynamically shown without that transform via the layers sidebar. All other layers will be transformed accordingly. [#7246](https://github.com/scalableminds/webknossos/pull/7246)
- OpenID Connect authorization can now use a client secret for added security. [#7263](https://github.com/scalableminds/webknossos/pull/7263)
- OpenID Connect authorization is now compatible with Providers that send the user information in an id_token. [#7294](https://github.com/scalableminds/webknossos/pull/7294)

### Changed
- Small messages during annotating (e.g. “finished undo”, “applying mapping…”) are now click-through so they do not block users from selecting tools. [7239](https://github.com/scalableminds/webknossos/pull/7239)
- Annotating volume data uses a transaction-based mechanism now. As a result, WK is more robust against partial saves (i.e., due to a crashing tab). [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Improved speed of saving volume data. [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Improved progress indicator when saving volume data. [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- The order of color layers can now also be manipulated in additive blend mode (see [#7188](https://github.com/scalableminds/webknossos/pull/7188)). [#7289](https://github.com/scalableminds/webknossos/pull/7289)
- OpenID Connect authorization now fetches the server’s public key automatically. The config keys `singleSignOn.openIdConnect.publicKey` and `singleSignOn.openIdConnect.publicKeyAlgorithm` are now unused. [7267](https://github.com/scalableminds/webknossos/pull/7267)

### Fixed
- Fixed that is was possible to have larger active segment ids that supported by the data type of the segmentation layer which caused the segmentation ids to overflow. [#7240](https://github.com/scalableminds/webknossos/pull/7240)
- Fixed that folders could appear in the dataset search output in the dashboard. [#7232](https://github.com/scalableminds/webknossos/pull/7232)
- Fixed that the edit icon for an annotation description could disappear in Firefox. [#7250](https://github.com/scalableminds/webknossos/pull/7250)
- Fixed that assigning an invalid script name (e.g. with special characters) would trigger an error in the database. Now leads to a more descriptive error. [#7525](https://github.com/scalableminds/webknossos/pull/7525)
- Fixed rendering error when multiple segmentation layers exist and the user switched between these. [#7291](https://github.com/scalableminds/webknossos/pull/7291)

### Removed

### Breaking Changes
- The task and project api have changed. Make sure to update to the latest webknossos python library version when interacting with task and projects via the python library. Compare [webknossos-libs#930](https://github.com/scalableminds/webknossos-libs/pull/930). [#7220](https://github.com/scalableminds/webknossos/pull/7220)
