# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.12.0...HEAD)

### Added
- Added the total volume of a dataset to a tooltip in the dataset info tab. [#8229](https://github.com/scalableminds/webknossos/pull/8229)
- Optimized performance of data loading with “fill value“ chunks. [#8271](https://github.com/scalableminds/webknossos/pull/8271)
- Added the option to export proofreading as segmentation [#8286](https://github.com/scalableminds/webknossos/pull/8286)
- The fill tool can now be adapted so that it only acts within a specified bounding box. Use the new "Restrict Floodfill" mode for that in the toolbar. [#8267](https://github.com/scalableminds/webknossos/pull/8267)
- Added the option for "Selective Segment Visibility" for segmentation layers. Select this option in the left sidebar to only show segments that are currently active or hovered.  [#8281](https://github.com/scalableminds/webknossos/pull/8281)
- A segment can be activated with doubleclick now. [#8281](https://github.com/scalableminds/webknossos/pull/8281)
- It is now possible to select the magnification of the layers on which an AI model will be trained. [#8266](https://github.com/scalableminds/webknossos/pull/8266)

### Changed
- Renamed "resolution" to "magnification" in more places within the codebase, including local variables. [#8168](https://github.com/scalableminds/webknossos/pull/8168)
- Layer names are now allowed to contain `$` as special characters. [#8241](https://github.com/scalableminds/webknossos/pull/8241)
- Datasets can now be renamed and can have duplicate names. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- Improved the default colors for skeleton trees. [#8228](https://github.com/scalableminds/webknossos/pull/8228)
- Allowed to train an AI model using differently sized bounding boxes. We recommend all bounding boxes to have equal dimensions or to have dimensions which are multiples of the smallest bounding box. [#8222](https://github.com/scalableminds/webknossos/pull/8222)
- Within the bounding box tool, the cursor updates immediately after pressing `ctrl`, indicating that a bounding box can be moved instead of resized. [#8253](https://github.com/scalableminds/webknossos/pull/8253)
- Improved the styling of active tools and modes in the toolbar. [#8295](https://github.com/scalableminds/webknossos/pull/8295)

### Fixed
- Fixed that listing datasets with the `api/datasets` route without compression failed due to missing permissions regarding public datasets. [#8249](https://github.com/scalableminds/webknossos/pull/8249)
- A "Locked by anonymous user" banner is no longer shown when opening public editable annotations of other organizations. [#8273](https://github.com/scalableminds/webknossos/pull/8273)
- Fixed a bug that uploading a zarr dataset with an already existing `datasource-properties.json` file failed. [#8268](https://github.com/scalableminds/webknossos/pull/8268)
- Fixed the organization switching feature for datasets opened via old links. [#8257](https://github.com/scalableminds/webknossos/pull/8257)
- Fixed that uploading an NML file without an organization id failed. Now the user's organization is used as fallback. [#8277](https://github.com/scalableminds/webknossos/pull/8277)
- Fixed that the frontend did not ensure a minimum length for annotation layer names. Moreover, names starting with a `.` are also disallowed now. [#8244](https://github.com/scalableminds/webknossos/pull/8244)
- Fixed a bug where in the add remote dataset view the dataset name setting was not in sync with the datasource setting of the advanced tab making the form not submittable. [#8245](https://github.com/scalableminds/webknossos/pull/8245)
- Fix read and update dataset route for versions 8 and lower. [#8263](https://github.com/scalableminds/webknossos/pull/8263)
- Fixed that task bounding boxes are again converted to user bounding boxes when uploading annotations via nmls. [#8280](https://github.com/scalableminds/webknossos/pull/8280)
- Added missing legacy support for `isValidNewName` route. [#8252](https://github.com/scalableminds/webknossos/pull/8252)
- Fixed some layout issues in the upload view. [#8231](https://github.com/scalableminds/webknossos/pull/8231)
- Fixed `FATAL: role "postgres" does not exist` error message in Docker compose. [#8240](https://github.com/scalableminds/webknossos/pull/8240)
- Fixed the Zarr 3 implementation not accepting BytesCodec without "configuration" key. [#8282](https://github.com/scalableminds/webknossos/pull/8282)
- Fixed that reloading the data of a volume annotation layer did not work properly. [#8298](https://github.com/scalableminds/webknossos/pull/8298)
- Removed the magnification slider for the TIFF export within the download modal if only one magnification is available for the selected layer. [#8297](https://github.com/scalableminds/webknossos/pull/8297)
- Fixed regression in styling of segment and skeleton tree tab. [#8307](https://github.com/scalableminds/webknossos/pull/8307)
- Fixed the template for neuron inferral using a custom workflow. [#8312](https://github.com/scalableminds/webknossos/pull/8312)

### Removed
- Removed support for HTTP API versions 3 and 4. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- Removed that a warning is shown when a dataset is served from a datastore that was marked with isScratch=true. [#8296](https://github.com/scalableminds/webknossos/pull/8296)

### Breaking Changes
