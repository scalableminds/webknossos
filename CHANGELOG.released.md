# Changelog (Released)

All notable user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.unreleased.md` for the changes which are not yet part of an official release.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## [25.02.1](https://github.com/scalableminds/webknossos/releases/tag/25.02.1) - 2025-02-26
[Commits](https://github.com/scalableminds/webknossos/compare/25.02.0...25.02.1)

### Fixed
- Fixed rare bug where saving got stuck. [#8409](https://github.com/scalableminds/webknossos/pull/8409)

## [25.02.0](https://github.com/scalableminds/webknossos/releases/tag/25.02.0) - 2025-02-17
[Commits](https://github.com/scalableminds/webknossos/compare/25.01.0...25.02.0)

### Highlights
- Starting now, proofreading (editable mapping) annotations will have a revertible history. Also the annotation version history is no longer split in individual tabs per layer. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
- Measurement tools are now accessible when viewing datasets outside of an annotation. [#8334](https://github.com/scalableminds/webknossos/pull/8334)

### Added
- It is now possible to start a split-merger evaluation when starting a neuron inference. [#8221](https://github.com/scalableminds/webknossos/pull/8221)
- Added the possibility to configure a rotation for a dataset, which can be toggled off and on when viewing and annotating data. [#8159](https://github.com/scalableminds/webknossos/pull/8159)
- When using the “Restore older Version” feature, there are no longer separate tabs for the different annotation layers. Only one linear annotation history is now used, and if you revert to an older version, all layers are reverted. If layers were added/deleted since then, that is also reverted. This also means that proofreading annotations can now be reverted to older versions as well. The description text of annotations is now versioned as well. [#7917](https://github.com/scalableminds/webknossos/pull/7917)
- Added the possibility to use the "merger mode" even when the user has annotated volume data in the current layer (as long as no other mapping is active). [#8335](https://github.com/scalableminds/webknossos/pull/8335)
- Added a note explaining that imported data is private by default to the dataset upload view. [#8354](https://github.com/scalableminds/webknossos/pull/8354)
- Measurement tools are now accessible when viewing datasets outside of an annotation. [#8334](https://github.com/scalableminds/webknossos/pull/8334)
- Support reading Blosc-compressed datasets with the “autoshuffle” parameter. [#8387](https://github.com/scalableminds/webknossos/pull/8387)

### Changed
- Improved the scrolling behaviour of sliders: Sliders must be focused to scroll them. Additionally, parent element scrolling is prevented when using the slider. [#8321](https://github.com/scalableminds/webknossos/pull/8321) [#8321](https://github.com/scalableminds/webknossos/pull/8321)
- Increase the flood fill maximum bounding box size limits for segmentation layers restricted to coarser mags. [#8382](https://github.com/scalableminds/webknossos/pull/8382)

### Fixed
- Fixed a silent bug in the dashboard when refreshing newest dataset list. [#8386](https://github.com/scalableminds/webknossos/pull/8386)
- Fixed a bug that lead to trees being dropped when merging to trees together. [#8359](https://github.com/scalableminds/webknossos/pull/8359)
- Fixed that the onboarding screen incorrectly appeared when a certain request failed. [#8356](https://github.com/scalableminds/webknossos/pull/8356)
- Fixed the segment registering in coarser mags for non-mag-aligned bounding boxes. [#8364](https://github.com/scalableminds/webknossos/pull/8364)
- Fixed using the flood fill tool in 2D mode for mags other than the finest one. [#8382](https://github.com/scalableminds/webknossos/pull/8382)

### Removed
 - Removed the feature to downsample existing volume annotations. All new volume annotations had a whole mag stack since [#4755](https://github.com/scalableminds/webknossos/pull/4755) (four years ago). [#7917](https://github.com/scalableminds/webknossos/pull/7917)

## [25.01.0](https://github.com/scalableminds/webknossos/releases/tag/25.01.0) - 2025-01-22
[Commits](https://github.com/scalableminds/webknossos/compare/24.12.0...25.01.0)

### Highlights
- The fill tool can now be adapted so that it only acts within a specified bounding box. Use the new "Restrict Floodfill" mode for that in the toolbar. [#8267](https://github.com/scalableminds/webknossos/pull/8267)
- Added the option for "Selective Segment Visibility" for segmentation layers. Select this option in the left sidebar to only show segments that are currently active or hovered.  [#8281](https://github.com/scalableminds/webknossos/pull/8281)
- Segment and tree names can be edited by double-clicking them. [#8316](https://github.com/scalableminds/webknossos/pull/8316)

### Added
- Added the total volume of a dataset to a tooltip in the dataset info tab. [#8229](https://github.com/scalableminds/webknossos/pull/8229)
- Optimized performance of data loading with “fill value“ chunks. [#8271](https://github.com/scalableminds/webknossos/pull/8271)
- Added the option to export a segmentation that was corrected with the proofreading tool to a new segmentation. [#8286](https://github.com/scalableminds/webknossos/pull/8286)
- A segment can be activated with double-click now. [#8281](https://github.com/scalableminds/webknossos/pull/8281)
- It is now possible to select the magnification of the layers on which an AI model will be trained. [#8266](https://github.com/scalableminds/webknossos/pull/8266)
- Added support for translations in OME NGFF zarr datasets (translation within coordinateTransformations on datasets). [#8311](https://github.com/scalableminds/webknossos/pull/8311)
- When the eraser tool is active, one can switch temporarily to the fill-segment tool by pressing shift and ctrl. Only pressing shift, switches to the pick-segment tool. [#8314](https://github.com/scalableminds/webknossos/pull/8314)
- Enabled auto sorting of Typescript imports in Biome linter. [#8313](https://github.com/scalableminds/webknossos/pull/8313)
- Clicking on a segment or tree group will show some details in the details table. [#8316](https://github.com/scalableminds/webknossos/pull/8316)

### Changed
- Renamed "resolution" to "magnification" in more places within the codebase, including local variables. [#8168](https://github.com/scalableminds/webknossos/pull/8168)
- Layer names are now allowed to contain `$` as special characters. [#8241](https://github.com/scalableminds/webknossos/pull/8241)
- Datasets can now be renamed and can have duplicate names. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- Starting an AI training job using multiple annotations now supports inputting task-IDs and considers their task bounding boxes. [#8310](https://github.com/scalableminds/webknossos/pull/8310)
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
- Fixed read and update dataset route for versions 8 and lower. [#8263](https://github.com/scalableminds/webknossos/pull/8263)
- Fixed that task bounding boxes are again converted to user bounding boxes when uploading annotations via nmls. [#8280](https://github.com/scalableminds/webknossos/pull/8280)
- Added missing legacy support for `isValidNewName` route. [#8252](https://github.com/scalableminds/webknossos/pull/8252)
- Fixed some layout issues in the upload view. [#8231](https://github.com/scalableminds/webknossos/pull/8231)
- Fixed `FATAL: role "postgres" does not exist` error message in Docker compose. [#8240](https://github.com/scalableminds/webknossos/pull/8240)
- Fixed the Zarr 3 implementation not accepting BytesCodec without "configuration" key. [#8282](https://github.com/scalableminds/webknossos/pull/8282)
- Fixed that reloading the data of a volume annotation layer did not work properly. [#8298](https://github.com/scalableminds/webknossos/pull/8298)
- Removed the magnification slider for the TIFF export within the download modal if only one magnification is available for the selected layer. [#8297](https://github.com/scalableminds/webknossos/pull/8297)
- Fixed regression in styling of segment and skeleton tree tab. [#8307](https://github.com/scalableminds/webknossos/pull/8307)
- Fixed the template for neuron inferral using a custom workflow. [#8312](https://github.com/scalableminds/webknossos/pull/8312)
- Fixed that the list of processing jobs crashed for deleted job types. [#8300](https://github.com/scalableminds/webknossos/pull/8300)
- Fixed an issue where you could not maximize or reposition the 3D/XZ viewport in Safari. [#8337](https://github.com/scalableminds/webknossos/pull/8337)
- Fixed upload of NGFF datasets with only one directory named "color". [#8341](https://github.com/scalableminds/webknossos/pull/8341/)
- Fixed an issue that could occur if the NGFF multiscale name was set to "/" when exploring. [#8341](https://github.com/scalableminds/webknossos/pull/8341/)

### Removed
- Removed support for HTTP API versions 3 and 4. [#8075](https://github.com/scalableminds/webknossos/pull/8075)
- Removed that a warning is shown when a dataset is served from a datastore that was marked with isScratch=true. [#8296](https://github.com/scalableminds/webknossos/pull/8296)

## [24.12.0](https://github.com/scalableminds/webknossos/releases/tag/24.12.0) - 2024-12-05
[Commits](https://github.com/scalableminds/webknossos/compare/24.11.1...24.12.0)

### Added
- When exploring remote URIs pasted from Neuroglancer, the format prefixes like `precomputed://` are now ignored, so users don’t have to remove them. [#8195](https://github.com/scalableminds/webknossos/pull/8195)

### Changed
- Reading image files on datastore filesystem is now done asynchronously. [#8126](https://github.com/scalableminds/webknossos/pull/8126)
- Improved error messages for starting jobs on datasets from other organizations. [#8181](https://github.com/scalableminds/webknossos/pull/8181)
- Terms of Service for Webknossos are now accepted at registration, not afterward. [#8193](https://github.com/scalableminds/webknossos/pull/8193)
- Removed bounding box size restriction for inferral jobs for super users. [#8200](https://github.com/scalableminds/webknossos/pull/8200)
- Improved logging for errors when loading datasets and problems arise during a conversion step. [#8202](https://github.com/scalableminds/webknossos/pull/8202)

### Fixed
- Fixed performance bottleneck when deleting a lot of trees at once. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fixed a bug where changing the color of a segment via the menu in the segments tab would update the segment color of the previous segment, on which the context menu was opened. [#8225](https://github.com/scalableminds/webknossos/pull/8225)
- Fixed a bug when importing an NML with groups when only groups but no trees exist in an annotation. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fixed a bug where trying to delete a non-existing node (via the API, for example) would delete the whole active tree. [#8176](https://github.com/scalableminds/webknossos/pull/8176)
- Fixed a bug where dataset uploads would fail if the organization directory on disk is missing. [#8230](https://github.com/scalableminds/webknossos/pull/8230)

### Removed
- Removed Google Analytics integration. [#8201](https://github.com/scalableminds/webknossos/pull/8201)

## [24.11.1](https://github.com/scalableminds/webknossos/releases/tag/24.11.1) - 2024-11-13
[Commits](https://github.com/scalableminds/webknossos/compare/24.10.0...24.11.1)

### Highlights
- It is now possible to add metadata in annotations to Trees and Segments. [#7875](https://github.com/scalableminds/webknossos/pull/7875)
- Added a button to the search popover in the skeleton and segment tab to select all matching non-group results. [#8123](https://github.com/scalableminds/webknossos/pull/8123)

### Added
- It is now possible to add metadata in annotations to Trees and Segments. [#7875](https://github.com/scalableminds/webknossos/pull/7875)
- Added a summary row to the time tracking overview, where times and annotations/tasks are summed. [#8092](https://github.com/scalableminds/webknossos/pull/8092)
- Most sliders have been improved: Wheeling above a slider now changes its value and double-clicking its knob resets it to its default value. [#8095](https://github.com/scalableminds/webknossos/pull/8095)
- It is now possible to search for unnamed segments with the full default name instead of only their id. [#8133](https://github.com/scalableminds/webknossos/pull/8133)
- Increased loading speed for precomputed meshes. [#8110](https://github.com/scalableminds/webknossos/pull/8110)
- Added a button to the search popover in the skeleton and segment tab to select all matching non-group results. [#8123](https://github.com/scalableminds/webknossos/pull/8123)
- Unified wording in UI and code: “Magnification”/“mag” is now used in place of “Resolution“ most of the time, compare [terminology document](https://docs.webknossos.org/webknossos/terminology.html). [#8111](https://github.com/scalableminds/webknossos/pull/8111)
- Added support for adding remote OME-Zarr NGFF version 0.5 datasets. [#8122](https://github.com/scalableminds/webknossos/pull/8122)
- Workflow reports may be deleted by superusers. [#8156](https://github.com/scalableminds/webknossos/pull/8156)

### Changed
- Some mesh-related actions were disabled in proofreading-mode when using meshfiles that were created for a mapping rather than an oversegmentation. [#8091](https://github.com/scalableminds/webknossos/pull/8091)
- Admins can now see and cancel all jobs. The owner of the job is shown in the job list. [#8112](https://github.com/scalableminds/webknossos/pull/8112)
- Migrated nightly screenshot tests from CircleCI to GitHub actions. [#8134](https://github.com/scalableminds/webknossos/pull/8134)
- Migrated nightly screenshot tests for wk.org from CircleCI to GitHub actions. [#8135](https://github.com/scalableminds/webknossos/pull/8135)
- Thumbnails for datasets now use the selected mapping from the view configuration if available. [#8157](https://github.com/scalableminds/webknossos/pull/8157)

### Fixed
- Fixed a bug during dataset upload in case the configured `datastore.baseFolder` is an absolute path. [#8098](https://github.com/scalableminds/webknossos/pull/8098) [#8103](https://github.com/scalableminds/webknossos/pull/8103)
- Fixed bbox export menu item [#8152](https://github.com/scalableminds/webknossos/pull/8152)
- When trying to save an annotation opened via a link including a sharing token, the token is automatically discarded in case it is insufficient for update actions but the users token is. [#8139](https://github.com/scalableminds/webknossos/pull/8139)
- Fix that scrolling in the trees and segments tab did not work while dragging. [#8162](https://github.com/scalableminds/webknossos/pull/8162)
- Fixed that uploading a dataset which needs a conversion failed when the angstrom unit was configured for the conversion. [#8173](https://github.com/scalableminds/webknossos/pull/8173)
- Fixed that the skeleton search did not automatically expand groups that contained the selected tree [#8129](https://github.com/scalableminds/webknossos/pull/8129)
- Fixed interactions in the trees and segments tab like the search due to a bug introduced by [#8162](https://github.com/scalableminds/webknossos/pull/8162). [#8186](https://github.com/scalableminds/webknossos/pull/8186)
- Fixed a bug that zarr streaming version 3 returned the shape of mag (1, 1, 1) / the finest mag for all mags. [#8116](https://github.com/scalableminds/webknossos/pull/8116)
- Fixed sorting of mags in outbound zarr streaming. [#8125](https://github.com/scalableminds/webknossos/pull/8125)
- Fixed a bug where you could not create annotations for public datasets of other organizations. [#8107](https://github.com/scalableminds/webknossos/pull/8107)
- Users without edit permissions to a dataset can no longer delete sharing tokens via the API. [#8083](https://github.com/scalableminds/webknossos/issues/8083)
- Fixed downloading task annotations of teams you are not in, when accessing directly via URI. [#8155](https://github.com/scalableminds/webknossos/pull/8155)
- Removed unnecessary scrollbars in skeleton tab that occurred especially after resizing. [#8148](https://github.com/scalableminds/webknossos/pull/8148)
- Deleting a bounding box is now possible independently of a visible segmentation layer. [#8164](https://github.com/scalableminds/webknossos/pull/8164)
- S3-compliant object storages can now be accessed via HTTPS. [#8167](https://github.com/scalableminds/webknossos/pull/8167)
- Fixed that skeleton tree nodes were created with the wrong mag. [#8185](https://github.com/scalableminds/webknossos/pull/8185)
- Fixed the expected type of a tree node received from the server. Fixes nml export to include the `inMag` field correctly. [#8187](https://github.com/scalableminds/webknossos/pull/8187)
- Fixed a layout persistence bug leading to empty viewports, triggered when switching between orthogonal, flight, or oblique mode. [#8177](https://github.com/scalableminds/webknossos/pull/8177)

### Removed

### Breaking Changes


## [24.10.0](https://github.com/scalableminds/webknossos/releases/tag/24.10.0) - 2024-09-24
[Commits](https://github.com/scalableminds/webknossos/compare/24.08.1...24.10.0)

### Highlights
- It is now possible to focus a bounding box in the bounding box tab by clicking its edges in a viewport or via a newly added context menu entry. [#8054](https://github.com/scalableminds/webknossos/pull/8054)
- Clicking on a bounding box within the bounding box tab centers it within the viewports and focuses it in the list. [#8049](https://github.com/scalableminds/webknossos/pull/8049)

### Added
- Added the option to export nd datasets as ome tiff or tiff stack. Previously, this was only possible for 3d datasets. [#7971](https://github.com/scalableminds/webknossos/pull/7971)
- Added an assertion to the backend to ensure unique keys in the metadata info of datasets and folders. [#8068](https://github.com/scalableminds/webknossos/issues/8068)
- The feature to register all segments within a bounding box now takes the current magnification into consideration, e.g. for calculating the volume limit for a bounding box. [#8082](https://github.com/scalableminds/webknossos/pull/8082)

### Changed
- For self-hosted versions, the text in the dataset upload view was updated to recommend switching to webknossos.org. [#7996](https://github.com/scalableminds/webknossos/pull/7996)
- Updated frontend package management to yarn version 4. [8061](https://github.com/scalableminds/webknossos/pull/8061)
- Updated React to version 18. Updated many peer dependencies including Redux, React-Router, antd, and FlexLayout. [#8048](https://github.com/scalableminds/webknossos/pull/8048)
- Improved the performance of context menus in the bounding box tab. [#8059](https://github.com/scalableminds/webknossos/pull/8059)

### Fixed
- The JS API v2 has been removed as it was deprecated by v3 in 2018. Please upgrade to v3 in case your scripts still use v2. [#8076](https://github.com/scalableminds/webknossos/pull/8076)
- Fixed that the precompute-meshfile button did not work in the segments tab. [#8077](https://github.com/scalableminds/webknossos/pull/8077)
- Removed the superfluous `_type` field when writing zarr3 codec jsons.

### Removed

### Breaking Changes


## [24.08.1](https://github.com/scalableminds/webknossos/releases/tag/24.08.1) - 2024-09-03
[Commits](https://github.com/scalableminds/webknossos/compare/24.08.0...24.08.1)

### Added
- If the opacity of a volume layer is zero, a warning is now shown in the layer settings tab. [#8003](https://github.com/scalableminds/webknossos/pull/8003)

## [24.08.0](https://github.com/scalableminds/webknossos/releases/tag/24.08.0) - 2024-09-02
[Commits](https://github.com/scalableminds/webknossos/compare/24.07.0...24.08.0)

### Highlights
- The AI-based Quick Select can now be run on multiple sections at once. This can be configured in the tool settings. Also, the underlying model now uses Segment Anything 2. [#7965](https://github.com/scalableminds/webknossos/pull/7965)
- Metadata entries can now be added to datasets and folders. The metadata can be viewed and edited in the dashboard in the right details tab. [#7886](https://github.com/scalableminds/webknossos/pull/7886)
- The AI-based Quick Select can now be triggered with a single click. Drawing a rectangle is still supported. [#7993](https://github.com/scalableminds/webknossos/pull/7993)
- Added the option to resume an unfinished upload even after browser restarts. [#7981](https://github.com/scalableminds/webknossos/pull/7981)
- Added a feature to register all segments for a given bounding box at once via the context menu of the bounding box. [#7979](https://github.com/scalableminds/webknossos/pull/7979)

### Added
- WEBKNOSSOS now automatically searches in subfolder / sub-collection identifiers for valid datasets in case a provided link to a remote dataset does not directly point to a dataset. [#7912](https://github.com/scalableminds/webknossos/pull/7912)
- Added the option to move a bounding box via dragging while pressing ctrl / meta. [#7892](https://github.com/scalableminds/webknossos/pull/7892)
- Added route `/import?url=<url_to_datasource>` to automatically import and view remote datasets. [#7844](https://github.com/scalableminds/webknossos/pull/7844)
- Added that newly created, modified and clicked on bounding boxes are now highlighted and scrolled into view, while the bounding box tool is active. [#7935](https://github.com/scalableminds/webknossos/pull/7935)
- The configured unit in the dataset upload view is now passed to the convert_to_wkw worker job. [#7970](https://github.com/scalableminds/webknossos/pull/7970)
- Added option to expand or collapse all subgroups of a segment group in the segments tab. [#7911](https://github.com/scalableminds/webknossos/pull/7911)
- The context menu that is opened upon right-clicking a segment in the dataview port now contains the segment's name. [#7920](https://github.com/scalableminds/webknossos/pull/7920)
- Upgraded backend dependencies for improved performance and stability. [#7922](https://github.com/scalableminds/webknossos/pull/7922)
- Added Support for streaming datasets via Zarr version 3. [#7941](https://github.com/scalableminds/webknossos/pull/7941)
- It is now saved whether segment groups are collapsed or expanded, so this information doesn't get lost e.g. upon page reload. [#7928](https://github.com/scalableminds/webknossos/pull/7928/)
- It is now saved whether skeleton groups are collapsed or expanded. This information is also persisted to NML output. [#7939](https://github.com/scalableminds/webknossos/pull/7939)
- The context menu entry "Focus in Segment List" expands all necessary segment groups in the segments tab to show the highlighted segment. [#7950](https://github.com/scalableminds/webknossos/pull/7950)
- In the proofreading mode, you can enable/disable that only the active segment and the hovered segment are rendered. [#7654](https://github.com/scalableminds/webknossos/pull/7654)
- Upgraded s3 client for improved performance when loading remote datasets. [#7936](https://github.com/scalableminds/webknossos/pull/7936)
- The performance of the bounding box tab was improved. [#7974](https://github.com/scalableminds/webknossos/pull/7974)
- Added support for reading zstd-compressed zarr2 datasets [#7964](https://github.com/scalableminds/webknossos/pull/7964)
- The alignment job is in a separate tab of the "AI Tools" now. The "Align Sections" AI job now supports including manually created matches between adjacent section given as skeletons. [#7967](https://github.com/scalableminds/webknossos/pull/7967)
- Added `api.tracing.createNode(position, options)` to the front-end API. [#7998](https://github.com/scalableminds/webknossos/pull/7998)
- Added links in the workflow report for skipped tasks to the corresponding workflow view. [#8006](https://github.com/scalableminds/webknossos/pull/8006)
- Upgraded backend dependencies for improved performance and stability, including a memory leak fix for FossilDB. [#8014](https://github.com/scalableminds/webknossos/pull/8014)

### Changed
- Replaced skeleton tab component with antd's `<Tree />`component. Added support for selecting tree ranges with SHIFT. [#7819](https://github.com/scalableminds/webknossos/pull/7819)
- The warning about a mismatch between the scale of a pre-computed mesh and the dataset scale's factor now also considers all supported mags of the active segmentation layer. This reduces the false posive rate regarding this warning. [#7921](https://github.com/scalableminds/webknossos/pull/7921/)
- It is no longer allowed to edit annotations of other organizations, even if they are set to public and to others-may-edit. [#7923](https://github.com/scalableminds/webknossos/pull/7923)
- When proofreading segmentations, the user can now interact with super-voxels directly in the data viewports. Additionally, proofreading is significantly faster because the segmentation data doesn't have to be re-downloaded after each merge/split operation. [#7654](https://github.com/scalableminds/webknossos/pull/7654)
- Changed internal data model changing an organization's name to id and its displayName to name. The previously existing id was removed. [#7386](https://github.com/scalableminds/webknossos/pull/7386)
- Because of the way our models are trained, AI analysis and training is disabled for 2D and ND datasets, as well as for color layers with data type uInt24. [#7957](https://github.com/scalableminds/webknossos/pull/7957)
- The overall performance was improved (especially for the segments tab). [#7958](https://github.com/scalableminds/webknossos/pull/7958)
- The performance for the skeleton tab was improved. [#7989](https://github.com/scalableminds/webknossos/pull/7989)
- Upgraded ant icons to version 5.4. [#8007](https://github.com/scalableminds/webknossos/pull/8007)
- Increased maximum depth for ai-based quick select from 5 to 16. [#8021](https://github.com/scalableminds/webknossos/pull/8021)
- Zarr-streaming now uses the new unit-aware voxel size. This means that [wk-libs client v0.14.25 or newer](https://github.com/scalableminds/webknossos-libs/releases) is needed for dataset zarr streaming. [#8012](https://github.com/scalableminds/webknossos/pull/8012)
- Updated React to version 17. [#7765](https://github.com/scalableminds/webknossos/pull/7765)

### Fixed
- Fixed a bug that allowed the default newly created bounding box to appear outside the dataset. In case the whole bounding box would be outside it is created regardless. [#7892](https://github.com/scalableminds/webknossos/pull/7892)
- Fixed a rare bug that could cause hanging dataset uploads. [#7932](https://github.com/scalableminds/webknossos/pull/7932)
- Fixed that comments of the active tree were not scrolled into view in some cases when switching to the comments tab. [8022](https://github.com/scalableminds/webknossos/pull/8022)
- Fixed that trashcan icons to remove layers during remote dataset upload were floating above the navbar. [#7954](https://github.com/scalableminds/webknossos/pull/7954)
- Fixed that the flood-filling action was available in the context menu although an editable mapping is active. Additionally volume related actions were removed from the context menu if only a skeleton layer is visible. [#7975](https://github.com/scalableminds/webknossos/pull/7975)
- Fixed that activating the skeleton tab would always change the active position to the active node. [#7958](https://github.com/scalableminds/webknossos/pull/7958)
- Made the newly added `filePaths` argument of the reserve upload route (see [#7981](https://github.com/scalableminds/webknossos/pull/7981)) optional to be backwards compatible with wklibs. [#8045](https://github.com/scalableminds/webknossos/pull/8045)
- Fixed that skeleton groups couldn't be collapsed or expanded in locked annotations. [#7988](https://github.com/scalableminds/webknossos/pull/7988)
- Fixed that the dashboard didn't notify the user about new datasets in the table. [#8025](https://github.com/scalableminds/webknossos/pull/8025)
- Fixed that registering segments for a bounding box did only work if the segmentation had mag 1. [#8009](https://github.com/scalableminds/webknossos/pull/8009)
- Fixed uploading datasets in neuroglancer precomputed and n5 data format. [#8008](https://github.com/scalableminds/webknossos/pull/8008)
- Various fixes for composing datasets with landmarks. Note that the interpretation of correspondence points was inverted for thin plate splines. [#7992](https://github.com/scalableminds/webknossos/pull/7992)

## [24.07.0](https://github.com/scalableminds/webknossos/releases/tag/24.07.0) - 2024-07-05
[Commits](https://github.com/scalableminds/webknossos/compare/24.06.0...24.07.0)

### Highlights
- Owners can lock explorative annotations now. Locked annotations cannot be modified by any user. An annotation can be locked in the annotations table and when viewing the annotation via the navbar dropdown menu. [#7801](https://github.com/scalableminds/webknossos/pull/7801)
- Added the ability to change the unit of the dataset voxel size to any supported unit of the [ome/ngff standard](https://github.com/ome/ngff/blob/39605eec64ceff481bb3a98f0adeaa330ab1ef26/latest/index.bs#L192). This allows users to upload and work with low-resolution datasets with a different base unit than nanometer. [#7783](https://github.com/scalableminds/webknossos/pull/7783)

### Added
- Added that proofreading merge actions reuse custom names of segments. A merge action now combines the potential existing custom names of both segments and a split-action copies the custom name to the split-off segment. [#7877](https://github.com/scalableminds/webknossos/pull/7877)
- Added the option to set a default mapping for a dataset in the dataset view configuration. The default mapping is loaded when the dataset is opened and the user / url does not configure something else. [#7858](https://github.com/scalableminds/webknossos/pull/7858)
- Uploading an annotation into a dataset that it was not created for now also works if the dataset is in a different organization. [#7816](https://github.com/scalableminds/webknossos/pull/7816)
- When downloading + reuploading an annotation that is based on a segmentation layer with active mapping, that mapping is now still selected after the reupload. [#7822](https://github.com/scalableminds/webknossos/pull/7822)
- In the Voxelytics workflow list, the name of the WEBKNOSSOS user who started the job is displayed. [#7794](https://github.com/scalableminds/webknossos/pull/7795)
- Start an alignment job (aligns the section in a dataset) via the "AI Analysis" button (not available to all users yet). [#7820](https://github.com/scalableminds/webknossos/pull/7820)
- Added additional validation for the animation job modal. Bounding boxes must be larger then zero. [#7883](https://github.com/scalableminds/webknossos/pull/7883)

### Changed
- The "WEBKNOSSOS Changelog" modal now lazily loads its content potentially speeding up the initial loading time of WEBKNOSSOS and thus improving the UX. [#7843](https://github.com/scalableminds/webknossos/pull/7843)
- Updated the min / max settings for the histogram to allow floating point color layers to have negative min / max values. [#7873](https://github.com/scalableminds/webknossos/pull/7873)
- Made the login, registration, forgot password and dataset dashboard pages more mobile friendly. [#7876](https://github.com/scalableminds/webknossos/pull/7876)
- From now on only project owner get a notification email upon project overtime. The organization specific email list `overTimeMailingList` was removed. [#7842](https://github.com/scalableminds/webknossos/pull/7842)
- Replaced skeleton comment tab component with antd's `<Tree />`component. [#7802](https://github.com/scalableminds/webknossos/pull/7802)
- Updated Typescript to version 5.5.0. [#7878](https://github.com/scalableminds/webknossos/pull/7878)

### Fixed
- Fixed a bug where the warning to zoom in to see the agglomerate mapping was shown to the user even when the 3D viewport was maximized and no volume data was shown. [#7865](https://github.com/scalableminds/webknossos/issues/7865)
- Fixed a bug that prevented saving new dataset settings. [#7903](https://github.com/scalableminds/webknossos/pull/7903)
- Fixed that on large screens the login forms were not horizontally centered. [#7909](https://github.com/scalableminds/webknossos/pull/7909)
- Fixed a bug where brushing on a fallback segmentation with active mapping and with segment index file would lead to failed saves. [#7833](https://github.com/scalableminds/webknossos/pull/7833)
- Fixed a bug where the "Hide Meshes" / "Show Meshes" options of the context menu for segment groups were not available although at least one mesh was set to visible / invisible. [#7890](https://github.com/scalableminds/webknossos/pull/7890)
- Fixed a bug where sometimes old mismatching javascript code would be served after upgrades. [#7854](https://github.com/scalableminds/webknossos/pull/7854)
- Fixed a bug where dataset uploads of zipped tiff data via the UI would be rejected. [#7856](https://github.com/scalableminds/webknossos/pull/7856)
- Fixed a bug with incorrect validation of layer names in the animation modal. [#7882](https://github.com/scalableminds/webknossos/pull/7882)
- Fixed a bug in the fullMesh.stl route used by the render_animation worker job, where some meshes in proofreading annotations could not be loaded. [#7887](https://github.com/scalableminds/webknossos/pull/7887)
- Fixed that dataset composition did not work when selecting only one dataset for composition. [#7889](https://github.com/scalableminds/webknossos/pull/7889)

### Removed
- REST API versions 1 and 2 are no longer supported. Current is 7. [#7783](https://github.com/scalableminds/webknossos/pull/7783)
- If the datasource-properties.json file for a dataset is missing or contains errors, WEBKNOSSOS no longer attempts to guess its contents from the raw data. Exploring remote datasets will still create the file. [#7697](https://github.com/scalableminds/webknossos/pull/7697)


## [24.06.0](https://github.com/scalableminds/webknossos/releases/tag/24.06.0) - 2024-05-27
[Commits](https://github.com/scalableminds/webknossos/compare/24.05.0...24.06.0)

### Highlights
- Within the proofreading tool, the user can now interact with the super voxels of a mesh in the 3D viewport. For example, this allows to merge or cut super voxels from another. As before, the proofreading tool requires an agglomerate file. [#7742](https://github.com/scalableminds/webknossos/pull/7742)
- In the time tracking view, all annotations and tasks can be shown for each user by expanding the table. The individual time spans spent with a task or annotating an explorative annotation can be accessed via CSV export. The detail view including a chart for the individual spans has been removed. [#7733](https://github.com/scalableminds/webknossos/pull/7733)

### Added
- Minor improvements for the timetracking overview (faster data loading, styling). [#7789](https://github.com/scalableminds/webknossos/pull/7789)
- Updated several backend dependencies for optimized stability and performance. [#7782](https://github.com/scalableminds/webknossos/pull/7782)
- Voxelytics workflows can be searched by name and hash. [#7790](https://github.com/scalableminds/webknossos/pull/7790)
- If a self-hosted WEBKNOSSOS instance has not been updated for six months or more, a closable banner proposes an upgrade to webknossos.org. [#7768](https://github.com/scalableminds/webknossos/pull/7768)

### Changed
- Non-admin or -manager users can no longer start long-running jobs that create datasets. This includes annotation materialization and AI inferrals. [#7753](https://github.com/scalableminds/webknossos/pull/7753)
- The config value `datastore.localFolderWhitelist` can now be set for each datastore individually. [#7800](https://github.com/scalableminds/webknossos/pull/7800)

### Fixed
- Fixed a bug where a toast that was reopened had a flickering effect during the reopening animation. [#7793](https://github.com/scalableminds/webknossos/pull/7793)
- Fixed a bug where some annotation times would be shown double. [#7787](https://github.com/scalableminds/webknossos/pull/7787)
- Fixed a bug where no columns were shown in the time tracking overview. [#7803](https://github.com/scalableminds/webknossos/pull/7803)
- Fixed a bug where ad-hoc meshes for coarse magnifications would have gaps. [#7799](https://github.com/scalableminds/webknossos/pull/7799)
- Fixed that the context menu didn't open correctly in the 3D viewport when right-clicking a node. [#7809](https://github.com/scalableminds/webknossos/pull/7809)
- Fixed that right-clicking a mesh in the 3D viewport did crash when the corresponding segmentation layer was not visible. [#7811](https://github.com/scalableminds/webknossos/pull/7811)


## [24.05.0](https://github.com/scalableminds/webknossos/releases/tag/24.05.0) - 2024-04-29
[Commits](https://github.com/scalableminds/webknossos/compare/24.04.0...24.05.0)

### Highlights
- Changed the time-tracking overview to show times spent in annotations and tasks and filter them by teams and projects. In the linked detail view, the tracked times can also be filtered by type (annotations or tasks) and project. [#7524](https://github.com/scalableminds/webknossos/pull/7524)
- Time Tracking now also works when editing other users’ shared annotations, and when editing proofreading annotations (a.k.a. editable mappings). [#7749](https://github.com/scalableminds/webknossos/pull/7749)
- Creating and deleting edges is now possible with ctrl+(alt/shift)+leftclick in orthogonal, flight and oblique mode. Also, the flight and oblique modes allow selecting nodes with leftclick, creating new trees with 'c' and deleting the active node with 'del'. [#7678](https://github.com/scalableminds/webknossos/pull/7678)

### Added
- Added Typescript definitions for @scalableminds/prop-types package. [#7744](https://github.com/scalableminds/webknossos/pull/7744)
- Added Typescript definitions for react-remarkable package. [#7748](https://github.com/scalableminds/webknossos/pull/7748)

### Changed
- Improved task list to sort tasks by project date, add option to expand all tasks at once and improve styling. [#7709](https://github.com/scalableminds/webknossos/pull/7709)
- The time tracking api route `/api/users/:id/loggedTime`, which is used by the webknossos-libs client, and groups the times by month, now uses UTC when determining month limits, rather than the server’s local timezone. [#7524](https://github.com/scalableminds/webknossos/pull/7524)
- Duplicated annotations are opened in a new browser tab. [#7724](https://github.com/scalableminds/webknossos/pull/7724)
- When proofreading segments and merging two segments, the segment item that doesn't exist anymore after the merge is automatically removed. [#7729](https://github.com/scalableminds/webknossos/pull/7729)
- Changed some internal APIs to use spelling dataset instead of dataSet. This requires all connected datastores to be the latest version. [#7690](https://github.com/scalableminds/webknossos/pull/7690)
- Toasts are shown until WEBKNOSSOS is running in the active browser tab again. Also, the content of most toasts that show errors or warnings is printed to the browser's console. [#7741](https://github.com/scalableminds/webknossos/pull/7741)
- Improved UI speed when editing the description of an annotation. [#7769](https://github.com/scalableminds/webknossos/pull/7769)
- Updated dataset animations to use the new meshing API. Animitation now support ad-hoc meshes and mappings. [#7692](https://github.com/scalableminds/webknossos/pull/7692)


### Fixed
- Fixed that the Command modifier on MacOS wasn't treated correctly for some shortcuts. Also, instead of the Alt key, the ⌥ key is shown as a hint in the status bar on MacOS. [#7659](https://github.com/scalableminds/webknossos/pull/7659)
- Moving from the time tracking overview to its detail view, the selected user was not preselected in the next view. [#7722](https://github.com/scalableminds/webknossos/pull/7722)
- Fixed incorrect position of WEBKNOSSOS logo in screenshots. [#7726](https://github.com/scalableminds/webknossos/pull/7726)
- Fixed that invisible nodes could be selected when using the skeleton tool. [#7732](https://github.com/scalableminds/webknossos/pull/7732)
- Fixed a bug where users that have no team memberships were omitted from the user list. [#7721](https://github.com/scalableminds/webknossos/pull/7721)
- Added an appropriate placeholder to be rendered in case the timetracking overview is otherwise empty. [#7736](https://github.com/scalableminds/webknossos/pull/7736)
- The overflow menu in the layer settings tab for layers with long names can now be opened comfortably. [#7747](https://github.com/scalableminds/webknossos/pull/7747)
- Fixed a bug where segmentation data looked scrambled when reading uint32 segmentation layers with CompressedSegmentation codec. [#7757](https://github.com/scalableminds/webknossos/pull/7757)
- Fixed a bug when downsampling a volume annotation that previously had only a restricted magnification set. [#7759](https://github.com/scalableminds/webknossos/pull/7759)

### Removed
- Meshfiles with version 2 or older are no longer supported. Talk to us about support in converting your old meshfiles. [#7764](https://github.com/scalableminds/webknossos/pull/7764)

### Breaking Changes
- When merging two trees or segments, the active item will always "survive" the merge operation (the clicked item will be merged *into* the active one). This was not consistent for certain skeleton-based operations (i.e., merging skeletons with a shortcut and proofreading segmentations with agglomerate skeletons). [#7729](https://github.com/scalableminds/webknossos/pull/7729)

## [24.04.0](https://github.com/scalableminds/webknossos/releases/tag/24.04.0) - 2024-03-25
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.3...24.04.0)

### Highlights
- Segment statistics are now available for ND datasets. [#7411](https://github.com/scalableminds/webknossos/pull/7411)
- Added a new "Split from all neighboring segments" feature for the proofreading mode. [#7611](https://github.com/scalableminds/webknossos/pull/7611)
- Added support for uploading N5 and Neuroglancer Precomputed datasets. [#7578](https://github.com/scalableminds/webknossos/pull/7578)

### Added
- Added support for storing analytics events in the Postgres. [#7594](https://github.com/scalableminds/webknossos/pull/7594) [#7609](https://github.com/scalableminds/webknossos/pull/7609)
- Webknossos can now open ND Zarr datasets with arbitrary axis orders (not limited to `**xyz` anymore). [#7592](https://github.com/scalableminds/webknossos/pull/7592)
- Added support for skeleton annotations within datasets that have transformed layers. The skeleton nodes will move according to the transforms when rendering a specific layer natively. Also, downloading visible trees can be done by incorporating the current transforms. However, note that the back-end export does not take transforms into account. [#7588](https://github.com/scalableminds/webknossos/pull/7588)
- If storage scan is enabled, the measured used storage is now displayed in the dashboard’s dataset detail view. [#7677](https://github.com/scalableminds/webknossos/pull/7677)
- Prepared support to download full stl meshes via the HTTP api. [#7587](https://github.com/scalableminds/webknossos/pull/7587)
- You can now place segment index files with your on-disk segmentation layers, which makes segment stats available when viewing these segmentations, and also when working on volume annotations based on these segmentation layers. [#7437](https://github.com/scalableminds/webknossos/pull/7437)
- Added an action to delete erroneous, unimported datasets directly from the dashboard. [#7448](https://github.com/scalableminds/webknossos/pull/7448)
- Added support for `window`, `active`, `inverted` keys from the `omero` info in the NGFF metadata. [7685](https://github.com/scalableminds/webknossos/pull/7685)
- Added getSegment function to JavaScript API. Also, createSegmentGroup returns the id of the new group now. [#7694](https://github.com/scalableminds/webknossos/pull/7694)
- Added support for importing N5 datasets without multiscales metadata. [#7664](https://github.com/scalableminds/webknossos/pull/7664)

### Changed
- Datasets stored in WKW format are no longer loaded with memory mapping, reducing memory demands. [#7528](https://github.com/scalableminds/webknossos/pull/7528)
- Content Security Policy (CSP) settings are now relaxed by default. To keep stricter CSP rules, add them to your specific `application.conf`. [#7589](https://github.com/scalableminds/webknossos/pull/7589)
- The state of whether a mapping is active and what exact mapping is now locked to the annotation upon the first volume annotation action to ensure future consistent results. Moreover, while a JSON mapping is active, no volume annotation can be done. [#7549](https://github.com/scalableminds/webknossos/pull/7549)
- WEBKNOSSOS now uses Java 21. [#7599](https://github.com/scalableminds/webknossos/pull/7599)
- Email verification is disabled by default. To enable it, set `webKnossos.user.emailVerification.activated` to `true` in your `application.conf`. [#7620](https://github.com/scalableminds/webknossos/pull/7620) [#7621](https://github.com/scalableminds/webknossos/pull/7621)
- Added more documentation for N5 and Neuroglancer precomputed web upload. [#7622](https://github.com/scalableminds/webknossos/pull/7622)
- Added the config key `webKnossos.user.timeTrackingOnlyWithSignificantChanges`, which when set to `true` will only track time if the user has made significant changes to the annotation. [#7627](https://github.com/scalableminds/webknossos/pull/7627)
- Only display UI elements to launch background jobs if the (worker) backend actually supports them. [#7591](https://github.com/scalableminds/webknossos/pull/7591)
- If the current dataset folder in the dashboard cannot be found (e.g., because somebody else deleted it), the page navigates to the root folder automatically. [#7669](https://github.com/scalableminds/webknossos/pull/7669)
- Voxelytics logs are now stored by organization name, rather than id, in Loki. This is in preparation of the unification of these two concepts. [#7687](https://github.com/scalableminds/webknossos/pull/7687)
- Using a segment index file with a different data type than uint16 will now result in an error. [#7698](https://github.com/scalableminds/webknossos/pull/7698)
- Improved performance of JSON mappings in preparation of frontend HDF5 mappings. [#7706](https://github.com/scalableminds/webknossos/pull/7706)
- Removed remaining ESLint configuration files and replaced circular dependency detection tool from madge to dpdm. [#7743](https://github.com/scalableminds/webknossos/pull/7743)

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
- Fixed incorrect menu position that could occur sometimes when clicking the ... button next to a segment. [#7680](https://github.com/scalableminds/webknossos/pull/7680)
- Fixed an error in the Loki integration to support Loki 2.9+. [#7684](https://github.com/scalableminds/webknossos/pull/7684)
- Fixed inconsistent style of antd components and odd behavior of dataset/annotation description Markdown input. [#7700](https://github.com/scalableminds/webknossos/pull/7700)

### Removed
- Removed the integration with BrainTracing user databases. [#7693](https://github.com/scalableminds/webknossos/pull/7693)

### Breaking Changes
- Updated antd UI library from version 4.24.15 to 5.13.2. Drop support for nodeJs version <18. [#7522](https://github.com/scalableminds/webknossos/pull/7522)


## [24.02.3](https://github.com/scalableminds/webknossos/releases/tag/24.02.3) - 2024-02-22
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.2...24.02.3)

### Fixed
- Fixed a bug where the user list view would show duplicate team roles, and user changes (e.g. giving experience) would sometimes fail. [#7646](https://github.com/scalableminds/webknossos/pull/7646)

## [24.02.2](https://github.com/scalableminds/webknossos/releases/tag/24.02.2) - 2024-02-15
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.1...24.02.2)

### Fixed
- Fixed a bug where the annotation list in the dashboard would attempt to display deleted annotations, and then fail. [#7628](https://github.com/scalableminds/webknossos/pull/7628)

## [24.02.1](https://github.com/scalableminds/webknossos/releases/tag/24.02.1) - 2024-02-15
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.0...24.02.1)

### Fixed
- Fixed a bug where the annotation list in the dashboard would attempt to display deleted annotations, and then fail. [#7628](https://github.com/scalableminds/webknossos/pull/7628)

## [24.02.0](https://github.com/scalableminds/webknossos/releases/tag/24.02.0) - 2024-01-26
[Commits](https://github.com/scalableminds/webknossos/compare/23.12.0...24.02.0)

### Highlights
- Added thumbnails to the dashboard dataset list. [#7479](https://github.com/scalableminds/webknossos/pull/7479)
- The data of segments can now be deleted in the segment side panel. [#7435](https://github.com/scalableminds/webknossos/pull/7435)
- Added the ability to compose a new dataset from existing dataset layers. This can be done with or without transforms (transforms will be derived from landmarks given via BigWarp CSV or WK NMLs). [#7395](https://github.com/scalableminds/webknossos/pull/7395)

### Added
- Added support for S3-compliant object storage services (e.g. MinIO) as a storage backend for remote datasets. [#7453](https://github.com/scalableminds/webknossos/pull/7453)
- Added support for blosc compressed N5 datasets. [#7465](https://github.com/scalableminds/webknossos/pull/7465)
- Added route for triggering the compute segment index worker job. [#7471](https://github.com/scalableminds/webknossos/pull/7471)
- Added the option to configure the name of the output segmentation layer in the neuron inferral job. [#7472](https://github.com/scalableminds/webknossos/pull/7472)
- Adhoc mesh rendering is now available for ND datasets.[#7394](https://github.com/scalableminds/webknossos/pull/7394)
- When setting up WEBKNOSSOS from the git repository for development, the organization directory for storing datasets is now automatically created on startup. [#7517](https://github.com/scalableminds/webknossos/pull/7517)
- Multiple segments can be dragged and dropped in the segments tab. [#7536](https://github.com/scalableminds/webknossos/pull/7536)
- Added the option to convert agglomerate skeletons to freely modifiable skeletons in the context menu of the Skeleton tab. [#7537](https://github.com/scalableminds/webknossos/pull/7537)
- The annotation list in the dashboard now also shows segment counts of volume annotations (after they have been edited). [#7548](https://github.com/scalableminds/webknossos/pull/7548)
- The buildinfo route now reports the supported HTTP API versions. [#7581](https://github.com/scalableminds/webknossos/pull/7581)
- After deleting specific teams, projects and task types, their names can now be re-used when creating new ones. [#7573](https://github.com/scalableminds/webknossos/pull/7573)

### Changed
- Improved loading speed of the annotation list. [#7410](https://github.com/scalableminds/webknossos/pull/7410)
- Improved loading speed for the users list. [#7466](https://github.com/scalableminds/webknossos/pull/7466)
- Admins and Team Managers can now also download job exports for jobs of other users, if they have the link. [#7462](https://github.com/scalableminds/webknossos/pull/7462)
- Updated some dependencies of the backend code (play 2.9, sbt 1.9, minor upgrades for others) for optimized performance. [#7366](https://github.com/scalableminds/webknossos/pull/7366)
- Processing jobs can now be distributed to multiple webknossos-workers with finer-grained configurability. Compare migration guide. [#7463](https://github.com/scalableminds/webknossos/pull/7463)
- A warning is shown when the user tries to annotate volume data in the "Overwrite Empty" mode when no voxels were changed. [#7526](https://github.com/scalableminds/webknossos/pull/7526)
- Updated antd UI library from version 4.24.8 to 4.24.15. [#7505](https://github.com/scalableminds/webknossos/pull/7505)
- Changed the default dataset search mode to also search in subfolders. [#7539](https://github.com/scalableminds/webknossos/pull/7539)
- When clicking a segment in the viewport, it is automatically focused in the segment list. A corresponding context menu entry was added as well. [#7512](https://github.com/scalableminds/webknossos/pull/7512)
- Updated the isValidName route in the API to return 200 for valid and invalid names. With this, the API version was bumped up to 6. [#7550](https://github.com/scalableminds/webknossos/pull/7550)
- Upgraded to Play 3. [#7562](https://github.com/scalableminds/webknossos/pull/7562)
- When no Email Address for New-User Notifications is configured, the organization owner will be notified. For overtime notifications, the project owner and the organization owner will be notified. [#7561](https://github.com/scalableminds/webknossos/pull/7561)
- The metadata for ND datasets and their annotation has changed: upper bound of additionalAxes is now stored as an exclusive value, called "end" in the NML format. [#7547](https://github.com/scalableminds/webknossos/pull/7547)
- Added support for the *index_location* parameter in sharded Zarr 3 datasets. [#7553](https://github.com/scalableminds/webknossos/pull/7553)

### Fixed
- Datasets with annotations can now be deleted. The concerning annotations can no longer be viewed but still be downloaded. [#7429](https://github.com/scalableminds/webknossos/pull/7429)
- Fixed several deprecation warnings for using antd's Tabs.TabPane components. [#7469](https://github.com/scalableminds/webknossos/pull/7469)
- Fixed problems when requests for loading data failed (could impact volume data consistency and rendering). [#7477](https://github.com/scalableminds/webknossos/pull/7477)
- The settings page for non-wkw datasets no longer shows a wall of non-applying errors. [#7475](https://github.com/scalableminds/webknossos/pull/7475)
- Fixed a bug where dataset deletion for ND datasets and datasets with coordinate transforms would not free the name even if no referencing annotations exist. [#7495](https://github.com/scalableminds/webknossos/pull/7495)
- Fixed a bug where the URL in the sharing link was wrongly decoded before encoding into a URI. [#7502](https://github.com/scalableminds/webknossos/pull/7502)
- Fixed a bug where loaded meshes were not encoded in the sharing link. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed a bug where meshes (or chunks of them) were always colored white, if they were loaded while the corresponding segmentation layer was disabled. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed a race condition when opening a short link, that would sometimes lead to an error toast. [#7507](https://github.com/scalableminds/webknossos/pull/7507)
- Fixed that the Segment Statistics feature was not available in the context menu of segment groups and in the context menu of the data viewports. [#7510](https://github.com/scalableminds/webknossos/pull/7510)
- Fixed rare bug which produced a benign error toast on some mouse interactions. [#7525](https://github.com/scalableminds/webknossos/pull/7525)
- Fixed a bug where dataset managers were not allowed to assign teams to new datasets that they are only member of. This already worked while editing the dataset later, but not during upload. [#7518](https://github.com/scalableminds/webknossos/pull/7518)
- Fixed regression in proofreading tool when automatic mesh loading was disabled and a merge/split operation was performed. [#7534](https://github.com/scalableminds/webknossos/pull/7534)
- Fixed that last dimension value in ND dataset was not loaded. [#7535](https://github.com/scalableminds/webknossos/pull/7535)
- Fixed the initialization of the mapping list for agglomerate views if json mappings are present. [#7537](https://github.com/scalableminds/webknossos/pull/7537)
- Fixed a bug where uploading ND volume annotations would lead to errors due to parsing of the chunk paths. [#7547](https://github.com/scalableminds/webknossos/pull/7547)
- Fixed a bug where listing the annotations of other users would result in empty lists even if there are annotations and you should be allowed to see them. [#7563](https://github.com/scalableminds/webknossos/pull/7563)
- Fixed the "Download Meshes" functionality which was affected by the recent introduction of the CSP. [#7577](https://github.com/scalableminds/webknossos/pull/7577)
- Fixed a bug where listing the annotations of other users would result in empty lists even if there are annotations, and you should be allowed to see them. [#7563](https://github.com/scalableminds/webknossos/pull/7563)
- Fixed errors showing when viewing the annotation list. [#7579](https://github.com/scalableminds/webknossos/pull/7579)
- Fixed a bug where all-zero chunks/buckets were omitted when downloading volume annotation even in case of a fallback segmentation layer, where their zeroed-bucket information is actually needed. [#7576](https://github.com/scalableminds/webknossos/pull/7576)
- Fixed a bug where zarr3 datasets with sharding that didn’t specify an explicit index_location in their metadata could not be read. [#7583](https://github.com/scalableminds/webknossos/pull/7583)

### Removed
- Removed Swagger/OpenAPI json description of the HTTP API. [#7494](https://github.com/scalableminds/webknossos/pull/7494)
- Removed several unused frontend libraries. [#7521](https://github.com/scalableminds/webknossos/pull/7521)

## [23.12.0](https://github.com/scalableminds/webknossos/releases/tag/23.12.0) - 2023-11-27
[Commits](https://github.com/scalableminds/webknossos/compare/23.11.0...23.12.0)

### Highlights
- Zarr datasets can now be directly uploaded to WEBKNOSSOS. [#7397](https://github.com/scalableminds/webknossos/pull/7397)

### Added
- Added support for reading uint24 rgb layers in datasets with zarr2/zarr3/n5/neuroglancerPrecomputed format, as used for voxelytics predictions. [#7413](https://github.com/scalableminds/webknossos/pull/7413)
- Adding a remote dataset can now be done by providing a Neuroglancer URI. [#7416](https://github.com/scalableminds/webknossos/pull/7416)
- Added a filter to the Task List->Stats column to quickly filter for tasks with "Prending", "In-Progress" or "Finished" instances. [#7430](https://github.com/scalableminds/webknossos/pull/7430)

### Changed
- An appropriate error is returned when requesting an API version that is higher than the current version. [#7424](https://github.com/scalableminds/webknossos/pull/7424)
- Upgraded FossilDB database used to store annotation data to version 0.1.27. [#7440](https://github.com/scalableminds/webknossos/pull/7440)

### Fixed
- Searching the segments in the sidebar will highlight newly focused segments properly now. [#7406](https://github.com/scalableminds/webknossos/pull/7406)
- Fixed a bug when opening a task for which a mag restriction exists. The bug only occurred when the referenced mag didn't exist in the dataset. [#7403](https://github.com/scalableminds/webknossos/pull/7403)
- Fixed that trees with ids around 1023 were invisible on some systems. [#7443](https://github.com/scalableminds/webknossos/pull/7443)
- Fixed styling issues with the maintenance banner so that it no longer overlaps other menus, tabs, and buttons. [#7421](https://github.com/scalableminds/webknossos/pull/7421)
- Exploring HTTP uris of unknown hosts no longer causes an exception error message to be displayed. [#7422](https://github.com/scalableminds/webknossos/pull/7422)
- Fixed the initialization of the dark theme if it was active during page load. [#7446](https://github.com/scalableminds/webknossos/pull/7446)
- Fixed a rare bug in ad-hoc meshing for voxelytics-created segmentations with agglomerate mappings. [#7449](https://github.com/scalableminds/webknossos/pull/7449)

## [23.11.0](https://github.com/scalableminds/webknossos/releases/tag/23.11.0) - 2023-10-24
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.2...23.11.0)

### Highlights
- Added a new tool that allows either measuring the distance of a path or a non-self-crossing area. [#7258](https://github.com/scalableminds/webknossos/pull/7258)
- For setups with webknossos-worker: Added a feature to create an engaging animation video of a dataset and its meshes processed in Blender. [#7348](https://github.com/scalableminds/webknossos/pull/7348)

### Added
- Added social media link previews for links to datasets and annotations (only if they are public or if the links contain sharing tokens). [#7331](https://github.com/scalableminds/webknossos/pull/7331)
- Loading sharded zarr3 datasets is now significantly faster. [#7363](https://github.com/scalableminds/webknossos/pull/7363) and [#7370](https://github.com/scalableminds/webknossos/pull/7370)
- OME-NGFF datasets with only 2 dimensions can now be imported and viewed. [#7349](https://github.com/scalableminds/webknossos/pull/7349)
- Higher-dimension coordinates (e.g., for the t axis) are now encoded in the URL, too, so that reloading the page will keep you at your current position. Only relevant for 4D datasets. [#7328](https://github.com/scalableminds/webknossos/pull/7328)
- WEBKNOSSOS can now also explore datasets on the local file system if enabled in the new config key `datastore.localFolderWhitelist`. [#7389](https://github.com/scalableminds/webknossos/pull/7389)
- It is now possible to download volume annotations as zarr- rather than wkw-based zip. This case also supports annotations on timeseries (ND) datasets. [#7288](https://github.com/scalableminds/webknossos/pull/7288)

### Changed
- Updated backend code to Scala 2.13, with upgraded Dependencies for optimized performance. [#7327](https://github.com/scalableminds/webknossos/pull/7327)
- Remote datasets with a datasource-properties.json can now also be imported without the need for OME metadata. [#7372](https://github.com/scalableminds/webknossos/pull/7372)
- Occurrences of isosurface were renamed to ad-hoc mesh. This also applies to configuration files. [#7350](https://github.com/scalableminds/webknossos/pull/7350)
- Improved user interface to start automatic AI analysis. [#7368](https://github.com/scalableminds/webknossos/pull/7368)

### Fixed
- Fixed that some segment (group) actions were not properly disabled for non-editable segmentation layers. [#7207](https://github.com/scalableminds/webknossos/issues/7207)
- Fixed a bug where data from zarr2 datasets that have a channel axis was broken. [#7374](https://github.com/scalableminds/webknossos/pull/7374)
- Fixed a bug which changed the cursor position while editing the name of a tree or the comment of a node. [#7390](https://github.com/scalableminds/webknossos/pull/7390)
- Streaming sharded zarr3 datasets from servers which do not respond with Accept-Ranges header is now possible. [#7392](https://github.com/scalableminds/webknossos/pull/7392)

## [23.10.2](https://github.com/scalableminds/webknossos/releases/tag/23.10.2) - 2023-09-26
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.1...23.10.2)

### Fixed
- Fixed that segment statistics were requested in the wrong resolution and without properly considering the dataset scale. [#7355](https://github.com/scalableminds/webknossos/pull/7355)

## [23.10.1](https://github.com/scalableminds/webknossos/releases/tag/23.10.1) - 2023-09-22
[Commits](https://github.com/scalableminds/webknossos/compare/23.10.0...23.10.1)

### Fixed
- Fixed that auto-saving only took place every 5 minutes instead of every 30 seconds. [#7352](https://github.com/scalableminds/webknossos/pull/7352)

## [23.10.0](https://github.com/scalableminds/webknossos/releases/tag/23.10.0) - 2023-09-21
[Commits](https://github.com/scalableminds/webknossos/compare/23.09.0...23.10.0)

### Highlights
- Datasets and annotations can now be more than 3-dimensional, using additional coordinates. [#7136](https://github.com/scalableminds/webknossos/pull/7136)
- Volume and bounding box information is shown in segments' context menus as well as in a separate modal in the segments tab. There is also an option to export the statistics. [#7249](https://github.com/scalableminds/webknossos/pull/7249)

### Added
- Added disabled drag handles to volume and skeleton layers for visual consistency. These layer cannot be dragged or reordered. [#7295](https://github.com/scalableminds/webknossos/pull/7295)
- Dataset thumbnails for grayscale layers can now be colored using the value in the view configuration. [#7255](https://github.com/scalableminds/webknossos/pull/7255)
- OpenID Connect authorization is now compatible with Providers that send the user information in an id_token. [#7294](https://github.com/scalableminds/webknossos/pull/7294)
- Segments and segment groups can be modified via the JS API. The following functions are available: registerSegment, removeSegment, updateSegment, createSegmentGroup, renameSegmentGroup, deleteSegmentGroup. [#7332](https://github.com/scalableminds/webknossos/pull/7332)
- A banner underneath the navigation bar informs about current and upcoming maintenances of WEBKNOSSOS. [#7284](https://github.com/scalableminds/webknossos/pull/7284)
- The AI-based quick select tool can now also be used for ND datasets. [#7287](https://github.com/scalableminds/webknossos/pull/7287)

### Changed
- On datasets with segment indices, ad-hoc meshing can now create non-connected meshes. [#7244](https://github.com/scalableminds/webknossos/pull/7244)
- Annotating volume data uses a transaction-based mechanism now. As a result, WK is more robust against partial saves (i.e., due to a crashing tab). [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Improved speed of saving volume data. [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Improved progress indicator when saving volume data. [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Adapted Zarr 3 implementations to recent changes in the specification (index codecs, zstd codec). [#7305](https://github.com/scalableminds/webknossos/pull/7305)
- When importing datasets with additional axes (more than 3 dimensions), the axis names are now sanitized and checked for duplicates. [#7308](https://github.com/scalableminds/webknossos/pull/7308)

### Fixed
- Fixed that the deletion of a selected segment would crash the segments tab. [#7316](https://github.com/scalableminds/webknossos/pull/7316)
- Fixed reading sharded Zarr 3 data from the local file system. [#7321](https://github.com/scalableminds/webknossos/pull/7321)
- Fixed no-bucket data zipfile when downloading volume annotations. [#7323](https://github.com/scalableminds/webknossos/pull/7323)
- Fixed too tight assertions when saving annotations, leading to failed save requests. [#7326](https://github.com/scalableminds/webknossos/pull/7326)
- Fixed a bug when saving large amounts of skeleton annotation data at once. [#7329](https://github.com/scalableminds/webknossos/pull/7329)
- Fixed a bug that prevented downloading public skeleton-only annotations by other users. [#7347](https://github.com/scalableminds/webknossos/pull/7347)

## [23.09.0](https://github.com/scalableminds/webknossos/releases/tag/23.09.0) - 2023-08-29
[Commits](https://github.com/scalableminds/webknossos/compare/23.08.0...23.09.0)

### Highlights
- Added option to select multiple segments in the segment list in order to perform batch actions. [#7242](https://github.com/scalableminds/webknossos/pull/7242)
- Added the option to change the ordering of color layers via drag and drop. This is useful when using the cover blend mode. [#7188](https://github.com/scalableminds/webknossos/pull/7188)

### Added
- Added configuration to require users' emails to be verified, added flow to verify emails via link. [#7161](https://github.com/scalableminds/webknossos/pull/7161)
- Added a route to explore and add remote datasets via API. [#7176](https://github.com/scalableminds/webknossos/pull/7176)
- Added a new button to the layer settings in view only dataset mode to save the current view configuration as the dataset's default. [#7205](https://github.com/scalableminds/webknossos/pull/7205)
- If a dataset layer is transformed (using an affine matrix or a thin plate spline), it can be dynamically shown without that transform via the layers sidebar. All other layers will be transformed accordingly. [#7246](https://github.com/scalableminds/webknossos/pull/7246)
- OpenID Connect authorization can now use a client secret for added security. [#7263](https://github.com/scalableminds/webknossos/pull/7263)

### Changed
- Small messages during annotating (e.g. “finished undo”, “applying mapping…”) are now click-through, so they do not block users from selecting tools. [#7239](https://github.com/scalableminds/webknossos/pull/7239)
- When exploring remote NGFF datasets with channels, layer names and colors are automatically imported if available in the metadata. [#7251](https://github.com/scalableminds/webknossos/pull/7251)
- Annotating volume data uses a transaction-based mechanism now. As a result, WK is more robust against partial saves (i.e., due to a crashing tab). [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Improved speed of saving volume data. [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- Improved progress indicator when saving volume data. [#7264](https://github.com/scalableminds/webknossos/pull/7264)
- The order of color layers can now also be manipulated in additive blend mode (see [#7188](https://github.com/scalableminds/webknossos/pull/7188)). [#7289](https://github.com/scalableminds/webknossos/pull/7289)
- OpenID Connect authorization now fetches the server’s public key automatically. The config keys `singleSignOn.openIdConnect.publicKey` and `singleSignOn.openIdConnect.publicKeyAlgorithm` are now unused. [7267](https://github.com/scalableminds/webknossos/pull/7267)
- When importing a remote dataset and adding another layer with a different voxel size, that layer is now scaled to match the first layer. [#7213](https://github.com/scalableminds/webknossos/pull/7213)


### Fixed
- Fixed that it was possible to have larger active segment ids than supported by the data type of the segmentation layer which caused the segmentation ids to overflow. [#7240](https://github.com/scalableminds/webknossos/pull/7240)
- Fixed that folders could appear in the dataset search output in the dashboard. [#7232](https://github.com/scalableminds/webknossos/pull/7232)
- Fixed that the edit icon for an annotation description could disappear in Firefox. [#7250](https://github.com/scalableminds/webknossos/pull/7250)
- Fixed that assigning an invalid script name (e.g. with special characters) would trigger an error in the database. Now leads to a more descriptive error. [#7525](https://github.com/scalableminds/webknossos/pull/7525)
- Fixed rendering error when multiple segmentation layers exist and the user switched between these. [#7291](https://github.com/scalableminds/webknossos/pull/7291)

### Breaking Changes
- The task and project api have changed. Make sure to update to the latest webknossos python library version when interacting with task and projects via the python library. Compare [webknossos-libs#930](https://github.com/scalableminds/webknossos-libs/pull/930). [#7220](https://github.com/scalableminds/webknossos/pull/7220)


## [23.08.0](https://github.com/scalableminds/webknossos/releases/tag/23.08.0) - 2023-07-24
[Commits](https://github.com/scalableminds/webknossos/compare/23.07.0...23.08.0)

### Highlights
- Added batch actions for segment groups, such as changing the color and loading or downloading all corresponding meshes. [#7164](https://github.com/scalableminds/webknossos/pull/7164).
- Improved support for touch devices by adding floating buttons for easier navigation and layout changes. [#7178](https://github.com/scalableminds/webknossos/pull/7178)
- The brush size can now be changed by selecting brush size presets. These presets are user configurable by assigning the current brush size to any of the preset buttons. Additionally the preset brush sizes can be set with keyboard shortcuts. [#7101](https://github.com/scalableminds/webknossos/pull/7101)

### Added
- Added a search feature for segments and segment groups. Listed segments/groups can be searched by id and name. [#7175](https://github.com/scalableminds/webknossos/pull/7175)
- Added a modal to the voxelytics workflow view that lists all artifacts with their file size and inode count. This helps to identify the largest artifacts to free disk space. [#7152](https://github.com/scalableminds/webknossos/pull/7152)
- Added new graphics and restyled empty dashboards. [#7008](https://github.com/scalableminds/webknossos/pull/7008)
- Added warning when using WEBKNOSSOS in an outdated browser. [#7165](https://github.com/scalableminds/webknossos/pull/7165)
- Re-added optional antialiasing for rendering. [#7180](https://github.com/scalableminds/webknossos/pull/7180)
- Added support for transformations with thin plate splines. [#7131](https://github.com/scalableminds/webknossos/pull/7131)
- WEBKNOSSOS can now read S3 remote dataset credentials from environment variables `AWS_ACCESS_KEY_ID` and `AWS_SECRET_KEY`. Those will be used, if available, when accessing remote datasets for which no explicit credentials are supplied. [#7170](https://github.com/scalableminds/webknossos/pull/7170)
- Added security.txt according to [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116). The content is configurable and it can be disabled. [#7182](https://github.com/scalableminds/webknossos/pull/7182)
- Added routes for super-users to manage users and organizations. [#7196](https://github.com/scalableminds/webknossos/pull/7196)
- Added tooltips to explain the task actions "Reset" and "Reset and Cancel". [#7201](https://github.com/scalableminds/webknossos/pull/7201)
- Thumbnail improvements: Thumbnails now use intensity configuration, thumbnails can now be created for float datasets, and they are cached across webknossos restarts. [#7190](https://github.com/scalableminds/webknossos/pull/7190)

### Changed
- Redesigned the info tab in the right-hand sidebar to be fit the new branding and design language. [#7110](https://github.com/scalableminds/webknossos/pull/7110)
- The proofreading tool is always visible now (even when disabled). [#7174](https://github.com/scalableminds/webknossos/pull/7174)
- Optimized processing of parallel requests (new thread pool configuration, asynchronous FossilDB client), improving performance and reducing idle waiting. [#7139](https://github.com/scalableminds/webknossos/pull/7139)
- Renamed "open" tasks to "pending" and slightly redesigned the available task assignment view for clarity. [#7187](https://github.com/scalableminds/webknossos/pull/7187)
- Being the uploader of a dataset no longer grants edit permissions on that dataset. [#7200](https://github.com/scalableminds/webknossos/pull/7200)
- Enabled the "Shift + middle-click" shortcut to load agglomerate skeletons for all tools, not just the Skeleton tool. [#7212](https://github.com/scalableminds/webknossos/pull/7212)

### Fixed
- Fixed rare rendering bug at viewport edge for anisotropic datasets. [#7163](https://github.com/scalableminds/webknossos/pull/7163)
- Fixed the dataset search which was broken when only the root folder existed. [#7177](https://github.com/scalableminds/webknossos/pull/7177)
- Correctly use configured fill-value for missing chunks of remote datasets hosted on gcs or s3. [#7198](https://github.com/scalableminds/webknossos/pull/7198)
- Correctly use configured fill-value for missing chunks of local non-wkw datasets. [#7216](https://github.com/scalableminds/webknossos/pull/7216)
- Adapted the proofreading docs to reflect the current state of the proofreading tool. [#7212](https://github.com/scalableminds/webknossos/pull/7212)
- Fixed a bug when adding remote datasets while not having write-access to the root folder. [#7221](https://github.com/scalableminds/webknossos/pull/7221)

### Removed
- Removed the "Globalize Floodfill" feature that could extend partial floodfills across an entire dataset. Please use the fill tool multiple times instead or make use of the proofreading tool when correcting large structures. [#7173](https://github.com/scalableminds/webknossos/pull/7173)

## [23.07.0](https://github.com/scalableminds/webknossos/releases/tag/23.07.0) - 2023-06-20
[Commits](https://github.com/scalableminds/webknossos/compare/23.06.0...23.07.0)

### Highlights
- Added new shortcuts for fast tool switching. Look at the updated [Keyboard Shortcuts documentation](https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html#tool-switching-shortcuts) to see the new shortcuts. [#7112](https://github.com/scalableminds/webknossos/pull/7112)
- Creating bounding boxes can now be done by dragging the left mouse button (when the bounding box tool is selected). To move around in the dataset while this tool is active, keep ALT pressed. [#7118](https://github.com/scalableminds/webknossos/pull/7118)

### Added
- Subfolders of the currently active folder are now also rendered in the dataset table in the dashboard. [#6996](https://github.com/scalableminds/webknossos/pull/6996)
- Added ability to view [zarr v3](https://zarr-specs.readthedocs.io/en/latest/v3/core/v3.0.html) datasets. [#7079](https://github.com/scalableminds/webknossos/pull/7079)
- Added an index structure for volume annotation segments, in preparation for per-segment statistics. [#7063](https://github.com/scalableminds/webknossos/pull/7063)
- Instead of showing all possible action items next to each other, there is now an overflow menu for layer actions. [#7123](https://github.com/scalableminds/webknossos/pull/7123)

### Changed
- Agglomerate skeletons can only be modified if the proofreading tool is active so they stay in sync with the underlying segmentation and agglomerate graph. Agglomerate skeletons cannot be modified using any other means. They are marked in the skeleton list using the clipboard icon of the proofreading tool. When exporting skeletons in the NML format, trees ("things") now have a `type` property which is either "DEFAULT" or "AGGLOMERATE". [#7086](https://github.com/scalableminds/webknossos/pull/7086)
- The cache for remote dataset array contents can now have a configured size in bytes. New config option `datastore.cache.imageArrayChunks.maxSizeBytes`. Default is 2 GB, consider increasing for production. [#7067](https://github.com/scalableminds/webknossos/pull/7067)
- Optimized processing of parallel requests for remote datasets, improving performance and reducing idle waiting. [#7137](https://github.com/scalableminds/webknossos/pull/7137)

### Fixed
- Fixed a bug where some volume annotations could not be downloaded. [#7115](https://github.com/scalableminds/webknossos/pull/7115)
- Fixed reading of some remote datasets where invalid data would follow valid gzip data, causing the decompression to fail. [#7119](https://github.com/scalableminds/webknossos/pull/7119)
- Fixed problems which could arise when annotating volume data at negative positions (which is not supported and is properly ignored now). [#7124](https://github.com/scalableminds/webknossos/pull/7124)
- Fixed some requests failing for streaming remote data via HTTP, which was observed when streaming data via Zarr from another WEBKNOSSOS instance. [#7125](https://github.com/scalableminds/webknossos/pull/7125)
- Fixed that the brush preview was inaccurate in some scenarios. [#7129](https://github.com/scalableminds/webknossos/pull/7129)
- Fixed order of decompression on neuroglancer precomputed datasets, which caused some segmentation layers to not load correctly. [#7135](https://github.com/scalableminds/webknossos/pull/7135/)

### Removed
- Support for [webknososs-connect](https://github.com/scalableminds/webknossos-connect) data store servers has been removed. Use the "Add Remote Dataset" functionality instead. [#7031](https://github.com/scalableminds/webknossos/pull/7031)

## [23.06.0](https://github.com/scalableminds/webknossos/releases/tag/23.06.0) - 2023-05-30
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.2...23.06.0)

### Highlights
- Added a machine-learning based quick select mode. Activate it via the "AI" button in the toolbar after selecting the quick-select tool. [#7051](https://github.com/scalableminds/webknossos/pull/7051)
- Added segment groups so that segments can be organized in a hierarchy (similar to skeletons). [#6966](https://github.com/scalableminds/webknossos/pull/6966)
- Added a new "cover" blend mode which renders the visible layers on top of each other. The new blend mode can be selected in the Data Rendering settings in the settings tab of the left side bar. [#6936](https://github.com/scalableminds/webknossos/pull/6936)

### Added
- In addition to drag and drop, the selected tree(s) in the Skeleton tab can also be moved into another group by right-clicking the target group and selecting "Move selected tree(s) here". [#7005](https://github.com/scalableminds/webknossos/pull/7005)
- Added support for remote datasets encoded with [brotli](https://datatracker.ietf.org/doc/html/rfc7932). [#7041](https://github.com/scalableminds/webknossos/pull/7041)
- Teams can be edited more straight-forwardly in a popup in the team edit page. [#7043](https://github.com/scalableminds/webknossos/pull/7043)
- Added support to download layers of a dataset as (OME) TIFF files in the download modal when viewing a dataset. [#7068](https://github.com/scalableminds/webknossos/pull/7068)
- Annotations with Editable Mappings (a.k.a Supervoxel Proofreading) can now be merged. [#7026](https://github.com/scalableminds/webknossos/pull/7026)
- The file size and inodes of artifacts are now aggregated and shown in the Voxelytics workflow list. [#7071](https://github.com/scalableminds/webknossos/pull/7071)
- It is possible to disable the automatic loading of meshes during proofreading. [##7076](https://github.com/scalableminds/webknossos/pull/7076)
- When viewing a public dataset by another organization, the organization is shown next to the dataset list, and when viewing the dataset or an annotation. [#7087](https://github.com/scalableminds/webknossos/pull/7087)

### Changed
- Loading of precomputed meshes got significantly faster (especially when using a mesh file for an oversegmentation with an applied agglomerate mapping). [#7001](https://github.com/scalableminds/webknossos/pull/7001)
- Improved speed of proofreading by only reloading affected areas after a split or merge. [#7050](https://github.com/scalableminds/webknossos/pull/7050)
- The minimum length of layer names in datasets was set from 3 to 1, enabling single-character names for layers. [#7064](https://github.com/scalableminds/webknossos/pull/7064)
- All dataset managers are now allowed to see all voxelytics workflow reports created in their organization. Previously, only admins could see all workflow reports, with other users seeing only their own. [#7080](https://github.com/scalableminds/webknossos/pull/7080)
- Improved performance for large meshes, especially when loaded from a precomputed oversegmentation mesh file. [#7077](https://github.com/scalableminds/webknossos/pull/7077)
- Slight increased the spacing and width of some VX reports elements. [#7094](https://github.com/scalableminds/webknossos/pull/7094)

### Fixed
- Fixed that changing a segment color could lead to a crash. [#7000](https://github.com/scalableminds/webknossos/pull/7000)
- The fill_value property of zarr dataset is now used when it is not a number. [#7017](https://github.com/scalableminds/webknossos/pull/7017)
- Fixed a bug that made downloads of public annotations fail occasionally. [#7025](https://github.com/scalableminds/webknossos/pull/7025)
- Fixed layouting of used storage space on the organization page. [#7034](https://github.com/scalableminds/webknossos/pull/7034)
- Fixed a bug where updating skeleton annotation tree group visibility would break the annotation. [#7037](https://github.com/scalableminds/webknossos/pull/7037)
- Fixed importing Neuroglancer Precomputed datasets that have a voxel offset in their header. [#7019](https://github.com/scalableminds/webknossos/pull/7019), [#7062](https://github.com/scalableminds/webknossos/pull/7062)
- Fixed reading Neuroglancer Precomputed datasets with non-integer resolutions. [#7041](https://github.com/scalableminds/webknossos/pull/7041)
- Fixed a bug where invalid email addresses were not readable in dark mode on the login/signup pages. [#7052](https://github.com/scalableminds/webknossos/pull/7052)
- Fixed a bug where users could sometimes not access their own time tracking information. [#7055](https://github.com/scalableminds/webknossos/pull/7055)
- Fixed a bug in the wallTime calculation of the Voxelytics reports. [#7059](https://github.com/scalableminds/webknossos/pull/7059)
- Fixed a bug where thumbnails and raw data requests with non-bucket-aligned positions would show data at slightly wrong positions. [#7058](https://github.com/scalableminds/webknossos/pull/7058)
- Avoid crashes when exporting big STL files. [#7074](https://github.com/scalableminds/webknossos/pull/7074)
- Fixed rare rendering bug for datasets with multiple layers and differing magnifications. [#7066](https://github.com/scalableminds/webknossos/pull/7066)
- Fixed a bug where duplicating annotations with Editable Mappings could lead to a server-side endless loop. [#7026](https://github.com/scalableminds/webknossos/pull/7026)
- Fixed the datasource-properties.json route for zarr-streaminge export of datasets that are not wkw/zarr.  [#7065](https://github.com/scalableminds/webknossos/pull/7065)
- Fixed an issue where you could no longer invite users to your organization even though you had space left. [#7078](https://github.com/scalableminds/webknossos/pull/7078)
- Fixed displayed units of used storage in the organization's overview page. [#7057](https://github.com/scalableminds/webknossos/pull/7057)
- Fixed a rendering bug that could occur when a dataset layer has missing mags (e.g., the first mag is 8-8-8). [#7082](https://github.com/scalableminds/webknossos/pull/7082)
- Fixed a bug where some volume annotations could not be duplicated or used as tasks. [#7085](https://github.com/scalableminds/webknossos/pull/7085)
- Fixed a superfluous rectangular geometry rendered at 0,0,0. [#7088](https://github.com/scalableminds/webknossos/pull/7088)

## [23.05.2](https://github.com/scalableminds/webknossos/releases/tag/23.05.2) - 2023-05-08
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.1...23.05.2)

### Fixed
- Fixed a bug where users could sometimes not access their own time tracking information. [#7055](https://github.com/scalableminds/webknossos/pull/7055)

## [23.05.1](https://github.com/scalableminds/webknossos/releases/tag/23.05.1) - 2023-05-02
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.0...23.05.1)

### Fixed
- Fixed rendering issues on some affected systems that led to "black holes". [#7018](https://github.com/scalableminds/webknossos/pull/7018)
- Added a workaround for a WebGL crash which could appear when a dataset contained many segmentation layers. [#6995](https://github.com/scalableminds/webknossos/pull/6995)

## [23.05.0](https://github.com/scalableminds/webknossos/releases/tag/23.05.0) - 2023-04-25
[Commits](https://github.com/scalableminds/webknossos/compare/23.04.2...23.05.0)

### Highlights
- Segments can now be removed from the segment list via the context menu. [#6944](https://github.com/scalableminds/webknossos/pull/6944)
- Added support for viewing neuroglancer precomputed segmentations using "compressed segmentation" compression. [#6947](https://github.com/scalableminds/webknossos/pull/6947)

### Added
- WEBKNOSSOS screenshots now include a logo in the lower left corner. Users with a paid license can disable this feature in the viewport options in the settings tab on the left side of the screen. [#6910](https://github.com/scalableminds/webknossos/pull/6910)
- Added support for datasets with mixed magnifications (e.g., one layer contains mag 2-2-2 and another contains 2-2-1). [#6943](https://github.com/scalableminds/webknossos/pull/6943)
- Added rendering precomputed meshes with level of detail depending on the zoom of the 3D viewport. This feature only works with version 3 mesh files. [#6909](https://github.com/scalableminds/webknossos/pull/6909)
- Editing the meta data of segments (e.g., the name) is now undoable. [#6944](https://github.com/scalableminds/webknossos/pull/6944)
- Added more icons and small redesigns for various pages in line with the new branding. [#6938](https://github.com/scalableminds/webknossos/pull/6938)
- Added more graphics and branding to job notification emails. [#6994](https://github.com/scalableminds/webknossos/pull/6994)
- Added action button in Team Admin page that links to the User Admin page to edit team members there. [#6958](https://github.com/scalableminds/webknossos/pull/6999)

### Changed
- Moved the view mode selection in the toolbar next to the position field. [#6949](https://github.com/scalableminds/webknossos/pull/6949)
- Redesigned welcome toast for new, anonymous users with new branding. [#6961](https://github.com/scalableminds/webknossos/pull/6961)
- When saving annotations, the URL of the webknossos instance is stored in the resulting NML file. [#6964](https://github.com/scalableminds/webknossos/pull/6964)

### Fixed
- Fixed unintended dependencies between segments of different volume layers which used the same segment id. Now, using the same segment id for segments in different volume layers should work without any problems. [#6960](https://github.com/scalableminds/webknossos/pull/6960)
- Fixed incorrect initial tab when clicking "Show Annotations" for a user in the user list. Also, the datasets tab was removed from that page as it was the same as the datasets table from the main dashboard. [#6957](https://github.com/scalableminds/webknossos/pull/6957)
- Fixed that unsaved changes were shown when opening an annotation, although there weren't any. [#6972](https://github.com/scalableminds/webknossos/pull/6972)
- Fixed misleading email about successful dataset upload, which was in some cases sent even for unusable datasets. [#6977](https://github.com/scalableminds/webknossos/pull/6977)
- Fixed upload of skeleton annotations with no trees, only bounding boxes, being incorrectly rejected. [#6985](https://github.com/scalableminds/webknossos/pull/6985)
- Fixed that Google Cloud Storage URLs with bucket names containing underscores could not be parsed. [#6998](https://github.com/scalableminds/webknossos/pull/6998)
- Fixed regression that caused public datasets to crash when not being logged in. [#7010](https://github.com/scalableminds/webknossos/pull/7010)

## [23.04.2](https://github.com/scalableminds/webknossos/releases/tag/23.04.2) - 2023-04-14
[Commits](https://github.com/scalableminds/webknossos/compare/23.04.1...23.04.2)

### Fixed
- Fixed rendering problems in orthogonal when working with nodes that were created in flight or oblique mode. [#6978](https://github.com/scalableminds/webknossos/pull/6978)

## [23.04.1](https://github.com/scalableminds/webknossos/releases/tag/23.04.1) - 2023-04-06
[Commits](https://github.com/scalableminds/webknossos/compare/23.04.0...23.04.1)

### Fixed
- Fixed incorrect initial tab when clicking "Show Annotations" for a user in the user list. Also, the datasets tab was removed from that page as it was the same as the datasets table from the main dashboard. [#6957](https://github.com/scalableminds/webknossos/pull/6957)

## [23.04.0](https://github.com/scalableminds/webknossos/releases/tag/23.04.0) - 2023-03-27
[Commits](https://github.com/scalableminds/webknossos/compare/23.03.1...23.04.0)

### Highlights
- Added email notifications for WK worker jobs. [#6918](https://github.com/scalableminds/webknossos/pull/6918)
- Added support for viewing sharded neuroglancer precomputed datasets. [#6920](https://github.com/scalableminds/webknossos/pull/6920)

### Added
- Added support for datasets where layers are transformed individually (with an affine matrix). Transformations can be specified via datasource-properties.json or via JS API (will be ephemeral, then). [#6748](https://github.com/scalableminds/webknossos/pull/6748)
- Added list of all respective team members to the administration page for teams. [#6915](https://github.com/scalableminds/webknossos/pull/6915)
- Added support for uploading zip64 files. [#6939](https://github.com/scalableminds/webknossos/pull/6939)

### Changed
- Interpolation during rendering is now more performance intensive, since the rendering approach was changed. Therefore, interpolation is disabled by default. On the flip side, the rendered quality is often higher than it used to be. [#6748](https://github.com/scalableminds/webknossos/pull/6748)
- Updated the styling of the "welcome" screen for new users to be in line with the new branding. [#6904](https://github.com/scalableminds/webknossos/pull/6904)
- Improved Terms-of-Service modal (e.g., allow to switch organization even when modal was blocking the remaining usage of WEBKNOSSOS). [#6930](https://github.com/scalableminds/webknossos/pull/6930)
- Uploads are now blocked when the organization’s storage quota is exceeded. [#6893](https://github.com/scalableminds/webknossos/pull/6893)

### Fixed
- Fixed an issue with text hints not being visible on the logout page for dark mode users. [#6916](https://github.com/scalableminds/webknossos/pull/6916)
- Fixed creating task types with a selected preferred mode. [#6928](https://github.com/scalableminds/webknossos/pull/6928)
- Fixed support for rendering of negative floats. [#6895](https://github.com/scalableminds/webknossos/pull/6895)
- Fixed caching issues with webworkers. [#6932](https://github.com/scalableminds/webknossos/pull/6932)
- Fixed download button for annotations which was disabled in some cases. [#6931](https://github.com/scalableminds/webknossos/pull/6931)
- Fixed antd deprecation warning for Dropdown menus. [#6898](https://github.com/scalableminds/webknossos/pull/6898)

## [23.03.1](https://github.com/scalableminds/webknossos/releases/tag/23.03.1) - 2023-03-14
[Commits](https://github.com/scalableminds/webknossos/compare/23.03.0...23.03.1)

### Added
- Added support for remote Zarr datasets with a `datasource-properties.json` as created by the WEBKNOSSOS Python library. [#6879](https://github.com/scalableminds/webknossos/pull/6879)

### Changed
- Upgraded antd UI library to v4.24.8 [#6865](https://github.com/scalableminds/webknossos/pull/6865)
- The view mode dropdown was slimmed down by using icons to make the toolbar more space efficient. [#6900](https://github.com/scalableminds/webknossos/pull/6900)

### Fixed
- Fixed a bug where N5 datasets reading with end-chunks that have a chunk size differing from the metadata-supplied chunk size would fail for some areas. [#6890](https://github.com/scalableminds/webknossos/pull/6890)
- Fixed potential crash when trying to edit certain annotation properties of a shared annotation. [#6892](https://github.com/scalableminds/webknossos/pull/6892)
- Fixed a bug where merging multiple volume annotations would result in inconsistent segment lists. [#6882](https://github.com/scalableminds/webknossos/pull/6882)
- Fixed a bug where uploading multiple annotations with volume layers at once would fail. [#6882](https://github.com/scalableminds/webknossos/pull/6882)
- Fixed a bug where dates were formatted incorrectly in Voxelytics reports. [#6908](https://github.com/scalableminds/webknossos/pull/6908)
- Fixed a rare bug which could cause an incorrectly initialized annotation so that changes were not saved in the current session. [#6914](https://github.com/scalableminds/webknossos/pull/6914)

## [23.03.0](https://github.com/scalableminds/webknossos/releases/tag/23.03.0) - 2023-02-28
[Commits](https://github.com/scalableminds/webknossos/compare/23.02.1...23.03.0)

### Highlights
- Remote datasets can now also be streamed from Google Cloud Storage URIs (`gs://`). [#6775](https://github.com/scalableminds/webknossos/pull/6775)
- Remote volume datasets in the neuroglancer precomputed format can now be viewed in WEBKNOSSOS. [#6716](https://github.com/scalableminds/webknossos/pull/6716)
- Added new mesh-related menu items to the context menu when a mesh is hovered in the 3d viewport. [#6813](https://github.com/scalableminds/webknossos/pull/6813)

### Added
- If an annotation that others are allowed to edit is opened, it will now be automatically locked. This prevents conflicts when multiple users try to edit it at the same time. [#6819](https://github.com/scalableminds/webknossos/pull/6819)
- Highlight 'organization owner' in Admin>User page. [#6832](https://github.com/scalableminds/webknossos/pull/6832)
- Added OME-TIFF export for bounding boxes. [#6838](https://github.com/scalableminds/webknossos/pull/6838) [#6874](https://github.com/scalableminds/webknossos/pull/6874)
- Added functions to get and set segment colors to the frontend API (`api.data.{getSegmentColor,setSegmentColor}`). [#6853](https://github.com/scalableminds/webknossos/pull/6853)

### Changed
- Limit paid team sharing features to respective organization plans. [#6767](https://github.com/scalableminds/webknossos/pull/6776)
- Rewrite the database tools in `tools/postgres` to JavaScript and adding support for non-default Postgres username-password combinations. [#6803](https://github.com/scalableminds/webknossos/pull/6803)
- Added owner name to organization page. [#6811](https://github.com/scalableminds/webknossos/pull/6811)
- Remove multiline <TextArea> support from <InputComponent>. [#6839](https://github.com/scalableminds/webknossos/pull/6839)
- Improved the performance of the dataset table in the dashboard. [#6834](https://github.com/scalableminds/webknossos/pull/6834)
- Updated the styling and background of login, password reset/change and sign up pages. [#6844](https://github.com/scalableminds/webknossos/pull/6844)
- Replaced date handling and formatting library momentjs with dayjs. [#6849](https://github.com/scalableminds/webknossos/pull/6849)

### Fixed
- Fixed saving allowed teams in dataset settings. [#6817](https://github.com/scalableminds/webknossos/pull/6817)
- Fixed log streaming in Voxelytics workflow reports. [#6828](https://github.com/scalableminds/webknossos/pull/6828) [#6831](https://github.com/scalableminds/webknossos/pull/6831)
- Fixed some layouting issues with line breaks in segment list/dataset info tab. [#6799](https://github.com/scalableminds/webknossos/pull/6799)
- Fixed basic auth for exploring remote http datasets. [#6866](https://github.com/scalableminds/webknossos/pull/6866)
- Fixed the layouting in the connectome tab. [#6864](https://github.com/scalableminds/webknossos/pull/6864)
- Fixed that the quick-select and floodfill tool didn't update the segment list. [#6867](https://github.com/scalableminds/webknossos/pull/6867)
- Fixed deprecation warnings for antd' <Menu> component in Navbar. [#6860](https://github.com/scalableminds/webknossos/pull/6860)
- Fixed that trying to reload a precomputed mesh via context menu could crash webKnossos. [#6875](https://github.com/scalableminds/webknossos/pull/6875)

### Removed
- Removed the old Datasets tab in favor of the Dataset Folders tab. [#6834](https://github.com/scalableminds/webknossos/pull/6834)

## [23.02.1](https://github.com/scalableminds/webknossos/releases/tag/23.02.1) - 2023-02-07
[Commits](https://github.com/scalableminds/webknossos/compare/23.02.0...23.02.1)

### Fixed
- Fixed a benign error message which briefly appeared after logging in. [#6810](https://github.com/scalableminds/webknossos/pull/6810)

## [23.02.0](https://github.com/scalableminds/webknossos/releases/tag/23.02.0) - 2023-02-01
[Commits](https://github.com/scalableminds/webknossos/compare/23.01.0...23.02.0)

### Highlights
- Changed branding of WEBKNOSSOS including a new logo, new primary colors, and UPPERCASE name. [#6739](https://github.com/scalableminds/webknossos/pull/6739)
- Precomputed meshes can now be loaded even when a mapping is active (HDF5 or an editable mapping produced by the proofreading tool). The precomputed mesh has to be computed without a mapping for this to work. [#6569](https://github.com/scalableminds/webknossos/pull/6569)

### Added
- The target folder of a dataset can now be specified during upload. Also, clicking "Add Dataset" from an active folder will upload the dataset to that folder by default. [#6704](https://github.com/scalableminds/webknossos/pull/6704)
- The storage used by an organization’s datasets can now be measured. [#6685](https://github.com/scalableminds/webknossos/pull/6685)

### Changed
- For remote datasets that require authentication, credentials are no longer stored in the respective JSON. [#6646](https://github.com/scalableminds/webknossos/pull/6646)
- Improved performance of opening a dataset or annotation. [#6711](https://github.com/scalableminds/webknossos/pull/6711)
- Redesigned organization page to include more infos on organization users, storage, webKnossos plan and provided opportunities to upgrade. [#6602](https://github.com/scalableminds/webknossos/pull/6602)
- Improves performance for ingesting Voxelytics reporting data. [#6732](https://github.com/scalableminds/webknossos/pull/6732)
- Implements statistics from combined workflow runs in the Voxelytics reporting. [#6732](https://github.com/scalableminds/webknossos/pull/6732)
- Limit paid task/project management features to respective organization plans. [6767](https://github.com/scalableminds/webknossos/pull/6767)
- The dataset list route `GET api/datasets` no longer respects the isEditable filter. [#6759](https://github.com/scalableminds/webknossos/pull/6759)
- Upgrade linter to Rome v11.0.0. [#6785](https://github.com/scalableminds/webknossos/pull/6785)

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
- Fixed proofreading when mag 1 doesn't exist for segmentation layer [#6795](https://github.com/scalableminds/webknossos/pull/6795)
- Fixed that the proofreading tool allowed to split/merge with segment 0 which led to an inconsistent state. [#6793](https://github.com/scalableminds/webknossos/pull/6793)

### Breaking Changes
- Changes the storage backend for Voxelytics logging from Elasticsearch to Loki. [#6770](https://github.com/scalableminds/webknossos/pull/6770)
- The dataset list route `GET api/datasets` no longer respects the isEditable filter. [#6759](https://github.com/scalableminds/webknossos/pull/6759)


## [23.01.0](https://github.com/scalableminds/webknossos/releases/tag/23.01.0) - 2023-01-03
[Commits](https://github.com/scalableminds/webknossos/compare/22.12.0...23.01.0)

### Highlights
- Added a new datasets tab to the dashboard which supports managing datasets in folders. Folders can be organized hierarchically and datasets can be moved into these folders. Selecting a dataset will show dataset details in a sidebar. [#6591](https://github.com/scalableminds/webknossos/pull/6591)
- webKnossos is now able to recover from a lost webGL context. [#6663](https://github.com/scalableminds/webknossos/pull/6663)
- Major performance improvements for brushing in coarse magnifications. [#6708](https://github.com/scalableminds/webknossos/pull/6708)

### Added
- Added sign in via OIDC. [#6534](https://github.com/scalableminds/webknossos/pull/6534)
- Added the option to search a specific folder in the new datasets tab. [#6677](https://github.com/scalableminds/webknossos/pull/6677)
- The new datasets tab in the dashboard allows multi-selection of datasets so that multiple datasets can be moved to a folder at once. As in typical file explorers, CTRL + left click adds individual datasets to the current selection. Shift + left click selects a range of datasets. [#6683](https://github.com/scalableminds/webknossos/pull/6683)

### Changed
- Bulk task creation now needs the taskTypeId, the task type summary will no longer be accepted. [#6640](https://github.com/scalableminds/webknossos/pull/6640)
- Error handling and reporting is more robust now. [#6700](https://github.com/scalableminds/webknossos/pull/6700)
- The Quick-Select settings are opened (and closed) automatically when labeling with the preview mode. That way, bulk labelings with preview mode don't require constantly opening the settings manually. [#6706](https://github.com/scalableminds/webknossos/pull/6706)

### Fixed
- Fixed import of N5 datasets. [#6668](https://github.com/scalableminds/webknossos/pull/6668)
- Fixed a bug where it was possible to create invalid an state by deleting teams that are referenced elsewhere. [6664](https://github.com/scalableminds/webknossos/pull/6664)
- Miscellaneous fixes for the new folder UI. [#6674](https://github.com/scalableminds/webknossos/pull/6674)
- Fixed import of remote datasets with multiple layers and differing resolution pyramid. #[6670](https://github.com/scalableminds/webknossos/pull/6670)
- Fixed broken Get-new-Task button in task dashboard. [#6677](https://github.com/scalableminds/webknossos/pull/6677)
- Fixed access of remote datasets using the Amazon S3 protocol [#6679](https://github.com/scalableminds/webknossos/pull/6679)
- Fixed a bug in line measurement that would lead to an infinite loop. [#6689](https://github.com/scalableminds/webknossos/pull/6689)
- Fixed a bug where malformed json files could lead to uncaught exceptions.[#6691](https://github.com/scalableminds/webknossos/pull/6691)
- Fixed rare crash in publications page. [#6700](https://github.com/scalableminds/webknossos/pull/6700)
- Respect the config value mail.smtp.auth (used to be ignored, always using true) [#6692](https://github.com/scalableminds/webknossos/pull/6692)

### Removed

### Breaking Changes


## [22.12.0](https://github.com/scalableminds/webknossos/releases/tag/22.12.0) - 2022-11-24
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.2...22.12.0)

### Highlights
- Added a new Quick-Select tool for volume annotation. This tools allows to draw a rectangle over a segment to annotate it automatically. The tool operates on the intensity data of the visible color layer and automatically fills out the segment starting from the center of the rectangle. Next to the tool, there is a settings button which allows to enable a preview mode and to tweak some other parameters. If the preview is enabled, the parameters can be fine-tuned while the preview updates instantly. [#6542](https://github.com/scalableminds/webknossos/pull/6542)
- The scale bar is now included in screenshots of the viewports made using the `Q` shortcut or the "Screenshot" menu entry. If the scale bar should not be included, disable it using "Settings - Viewport Options - Show Scalebars". [#6644](https://github.com/scalableminds/webknossos/pull/6644)

### Added
- The largest segment id for a segmentation layer can be computed automatically from the dataset settings page. [#6415](https://github.com/scalableminds/webknossos/pull/6415)
- Button for switching organizations for Voxelytics workflows. [#6572](https://github.com/scalableminds/webknossos/pull/6572)
- Added ability to shuffle / set colors for a whole tree group. [#6586](https://github.com/scalableminds/webknossos/pull/6586)
- Annotation layers can now be removed. [#6593](https://github.com/scalableminds/webknossos/pull/6593)
- When adding remote Zarr datasets with multiple channels, channels are converted into layers. [#6609](https://github.com/scalableminds/webknossos/pull/6609)
- When adding a remote OME-NGFF dataset with labels, these are added as segmentation layers. [#6638](https://github.com/scalableminds/webknossos/pull/6638)
- When creating an annotation from the dataset view, a previously selected mapping of the segmentation layer is now automatically selected in the volume annotation layer fallback segmentation as well. [#6647](https://github.com/scalableminds/webknossos/pull/6647)

### Changed
- The log viewer in the Voxelytics workflow reporting now uses a virtualized list. [#6579](https://github.com/scalableminds/webknossos/pull/6579)
- Node positions are always handled as integers. They have always been persisted as integers by the server, anyway, but the session in which a node was created handled the position as floating point in earlier versions. [#6589](https://github.com/scalableminds/webknossos/pull/6589)
- Jobs can no longer be started on datastores without workers. [#6595](https://github.com/scalableminds/webknossos/pull/6595)
- When downloading volume annotations with volume data skipped, the nml volume tag is now included anyway (but has no location attribute in this case). [#6566](https://github.com/scalableminds/webknossos/pull/6566)
- Re-phrased some backend (error) messages to improve clarity and provide helping hints. [#6616](https://github.com/scalableminds/webknossos/pull/6616)
- The layer visibility is now encoded in the sharing link. The user opening the link will see the same layers that were visible when copying the link. [#6634](https://github.com/scalableminds/webknossos/pull/6634)
- Voxelytics workflows can now be viewed by anyone with the link who is in the right organization. [#6622](https://github.com/scalableminds/webknossos/pull/6622)
- Improve performance for handling of volume annotation data (saving/undo/redo). [#6652](https://github.com/scalableminds/webknossos/pull/6652)
- When importing an annotation into an existing annotation, webKnossos ensures that bounding boxes are not duplicated in case they exist in the current *and* imported annotation. [#6648](https://github.com/scalableminds/webknossos/pull/6648)
- Reworked the proofreading mode so that agglomerate skeletons are no longer needed (nor automatically loaded). Instead, segments can be selected by left-clicking onto them, indicated by a small white cross. To merge or split agglomerates, then either use the shortcuts `Shift + Leftclick`/`Ctrl + Leftclick` or use the context menu. [#6625](https://github.com/scalableminds/webknossos/pull/6625)

### Fixed
- Fixed a bug in the dataset import view, where the layer name text field would lose focus after each key press. [#6615](https://github.com/scalableminds/webknossos/pull/6615)
- Fixed importing NGFF Zarr datasets with non-scale transforms. [#6621](https://github.com/scalableminds/webknossos/pull/6621)
- Fixed a regression in NGFF Zarr import for datasets with no channel axis. [#6636](https://github.com/scalableminds/webknossos/pull/6636)
- Fixed broken creation of tasks using base NMLs. [#6634](https://github.com/scalableminds/webknossos/pull/6634)
- Fixed that the precomputation of meshes didn't take the active mapping into account. [#6651](https://github.com/scalableminds/webknossos/pull/6651)
- Fixed false-positive warning about an outdated annotation version. [#6656](https://github.com/scalableminds/webknossos/pull/6656)
- Fixed that segment statistics seemed to be available but broken for segments without index. [#7377](https://github.com/scalableminds/webknossos/pull/7377)

## [22.11.2](https://github.com/scalableminds/webknossos/releases/tag/22.11.2) - 2022-11-10
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.1...22.11.2)

### Changed
- When merging annotations, bounding boxes are no longer duplicated. [#6576](https://github.com/scalableminds/webknossos/pull/6576)

### Fixed
- Fixed importing a dataset from disk. [#6615](https://github.com/scalableminds/webknossos/pull/6615)

## [22.11.1](https://github.com/scalableminds/webknossos/releases/tag/22.11.1) - 2022-10-27
[Commits](https://github.com/scalableminds/webknossos/compare/22.11.0...22.11.1)

### Added
- Turned successful dataset conversions into a clickable link. [#6583](https://github.com/scalableminds/webknossos/pull/6583)

### Fixed
- Fixed a rare crash in newer Firefox versions. [#6561](https://github.com/scalableminds/webknossos/pull/6561)
- Fixed the positions of precomputed meshes when using a v3 mesh file. [#6588](https://github.com/scalableminds/webknossos/pull/6588)

## [22.11.0](https://github.com/scalableminds/webknossos/releases/tag/22.11.0) - 2022-10-24
[Commits](https://github.com/scalableminds/webknossos/compare/22.10.0...22.11.0)

### Highlights
- Remote n5 datasets can now also be explored and added. [#6520](https://github.com/scalableminds/webknossos/pull/6520)
- Tasks can now be assigned to individual users directly. [#6551](https://github.com/scalableminds/webknossos/pull/6551)
- Support for a new mesh file format which allows up to billions of meshes. [#6491](https://github.com/scalableminds/webknossos/pull/6491)

### Added
- The task creation page now links to creation pages for task types, projects etc., for a smoother task administration experience. [#6513](https://github.com/scalableminds/webknossos/pull/6513)
- Improved performance for applying agglomerate mappings on segmentation data. [#6532](https://github.com/scalableminds/webknossos/pull/6532)
- Added backspace as an additional keyboard shortcut for deleting the active node. [#6554](https://github.com/scalableminds/webknossos/pull/6554)
- When reloading a layer, because the underlying data has changed, the histogram will also be reloaded and reflect the changes. [#6537](https://github.com/scalableminds/webknossos/pull/6537)
- Enable "What's New" update information for all instances. [#6563](https://github.com/scalableminds/webknossos/pull/6563)
- Add context-menu option to delete skeleton root group. [#6553](https://github.com/scalableminds/webknossos/pull/6553)
- Added remaining task time estimation (ETA) for Voxelytics tasks in workflow reporting. [#6564](https://github.com/scalableminds/webknossos/pull/6564)
- Added a help button to the UI to send questions and feedbacks to the dev team. [#6560](https://github.com/scalableminds/webknossos/pull/6560)

### Changed
- Creating tasks in bulk now also supports referencing task types by their summary instead of id. [#6486](https://github.com/scalableminds/webknossos/pull/6486)
- Navbar changes: Move dropdown menu into separate Menu button. Removed toggle-button (cog icon)for left-hand side bar from navbar. [#6558](https://github.com/scalableminds/webknossos/pull/6558)
- Upgraded Typescript to v4.8 [#6567](https://github.com/scalableminds/webknossos/pull/6567)

### Fixed
- Fixed a bug where some file requests replied with error 400 instead of 404, confusing some zarr clients. [#6515](https://github.com/scalableminds/webknossos/pull/6515)
- Fixed URL for private Zarr streaming links to volume annotations. [#6515](https://github.com/scalableminds/webknossos/pull/6541)
- Fixed a bug where the `transform` of a new mesh file wasn't taken into account for the rendering of meshes. [#6552](https://github.com/scalableminds/webknossos/pull/6552)
- Fixed a rare crash when splitting/merging a large skeleton. [#6557](https://github.com/scalableminds/webknossos/pull/6557)
- Fixed a bug where some features were unavailable for annotations for datasets of foreign organizations. [#6548](https://github.com/scalableminds/webknossos/pull/6548)

## [22.10.0](https://github.com/scalableminds/webknossos/releases/tag/22.10.0) - 2022-09-27
[Commits](https://github.com/scalableminds/webknossos/compare/22.09.0...22.10.0)

### Highlights
- Added a context menu option to extract the shortest path between two nodes as a new tree. Select the source node and open the context menu by right-clicking on another node in the same tree. [#6423](https://github.com/scalableminds/webknossos/pull/6423)
- Add setting for gamma correction for color and grayscale layers in the left sidebar. [#6439](https://github.com/scalableminds/webknossos/pull/6439)
- Added a context menu option to separate an agglomerate skeleton using Min-Cut. Activate the Proofreading tool, select the source node and open the context menu by right-clicking on the target node which you would like to separate through Min-Cut. [#6361](https://github.com/scalableminds/webknossos/pull/6361)
- The color of a segments can now be changed in the segments tab. Rightclick a segment in the list and select "Change Color" to open a color picker. [#6372](https://github.com/scalableminds/webknossos/pull/6372)
- Sharing links are shortened by default. Within the sharing modal, this shortening behavior can be disabled. [#6461](https://github.com/scalableminds/webknossos/pull/6461)
- The largestSegmentId is no longer a required property for segmentation layers. It is still recommended to set the property, since the generation of new segment IDs is blocked during volume annotation. However, annotating with manually set IDs is still possible. This change simplifies the import of datasets into webKnossos. [#6414](https://github.com/scalableminds/webknossos/pull/6414)

### Added
- Zarr-based remote dataset import now also works for public AWS S3 endpoints with no credentials. [#6421](https://github.com/scalableminds/webknossos/pull/6421)
- Added a "clear" button to reset skeletons/meshes after successful mergers/split. [#6459](https://github.com/scalableminds/webknossos/pull/6459)
- The proofreading tool now supports merging and splitting (via min-cut) agglomerates by right-clicking a segment (and not a node). Note that there still has to be an active node so that both partners of the operation are defined. [#6464](https://github.com/scalableminds/webknossos/pull/6464)
- Added workflow reporting and logging features for Voxelytics into webKnossos. If activated, the workflows can be accessed from the `Administration` > `Voxelytics` menu item. [#6416](https://github.com/scalableminds/webknossos/pull/6416) [#6460](https://github.com/scalableminds/webknossos/pull/6460)
- Added possibility to read N5 datasets. [#6466](https://github.com/scalableminds/webknossos/pull/6466)
- Added "shift + w" shortcut to cycle backwards through annotation tools. [#6493](https://github.com/scalableminds/webknossos/pull/6493)

### Changed
- Selecting a node with the proofreading tool won't have any side effects anymore. Previous versions could load additional agglomerate skeletons in certain scenarios which could be confusing. [#6477](https://github.com/scalableminds/webknossos/pull/6477)
- Removed optional "resolution" parameter from /datasets/:organizationName/:dataSetName/layers/:dataLayerName/data route. Use mag instead. [#6479](https://github.com/scalableminds/webknossos/pull/6479)
- Changed how volumes containing no data are stored. Now the selection of magnifications is correctly exported and imported. [#6481](https://github.com/scalableminds/webknossos/pull/6481)
- The "Restore Older Version" list is now paginated which improves performance for in case many versions exist. [#6483](https://github.com/scalableminds/webknossos/pull/6483)

### Fixed
- Fixed sharing button for users who are currently visiting a dataset or annotation which was shared with them. [#6438](https://github.com/scalableminds/webknossos/pull/6438)
- Fixed the duplicate function for annotations with an editable mapping (a.k.a. supervoxel proofreading) layer. [#6446](https://github.com/scalableminds/webknossos/pull/6446)
- Fixed isosurface loading for volume annotations with mappings. [#6458](https://github.com/scalableminds/webknossos/pull/6458)
- Fixed importing of remote datastore (e.g., zarr) when datastore is set up separately. [#6462](https://github.com/scalableminds/webknossos/pull/6462)
- Fixed a crash which could happen when using the "Automatically clip histogram" feature in certain scenarios. [#6433](https://github.com/scalableminds/webknossos/pull/6433)
- Fixed loading agglomerate skeletons for agglomerate ids larger than 2^31. [#6472](https://github.com/scalableminds/webknossos/pull/6472)
- Fixed bug which could lead to conflict-warnings even though there weren't any. [#6477](https://github.com/scalableminds/webknossos/pull/6477)
- Fixed that one could not change the color of a segment or tree in Firefox. [#6488](https://github.com/scalableminds/webknossos/pull/6488)
- Fixed validation of layer selection when trying to start globalization of floodfills. [#6497](https://github.com/scalableminds/webknossos/pull/6497)
- Fixed filtering for public datasets in dataset table. [#6496](https://github.com/scalableminds/webknossos/pull/6496)

## [22.09.0](https://github.com/scalableminds/webknossos/releases/tag/22.09.0) - 2022-08-25
[Commits](https://github.com/scalableminds/webknossos/compare/22.08.0...22.09.0)

### Highlights
- Added an "extrude segment" feature which is similar to the old "copy from previous slice" feature. The segment interpolation and the new segment extrusion feature are both available via the toolbar (see the dropdown icon which was added to the old interpolation button). [#6370](https://github.com/scalableminds/webknossos/pull/6370)
- The owner of an annotation can allow other users, who may see the annotation, to also edit it. Note that parallel writes are not supported and would lead to conflicts. [#6236](https://github.com/scalableminds/webknossos/pull/6236)
- Added support for ad-hoc meshing for volume annotation layers with fallback segmentations. [#6369](https://github.com/scalableminds/webknossos/pull/6369)
- Added support for 64-bit segmentations (uint64). Note that the actual support only covers IDs up to 2^53 - 1 (matches the JavaScript number type). Also note that JSON mappings are only compatible with segment ids that only use the lower 32 bits. [#6317](https://github.com/scalableminds/webknossos/pull/6317)
- WebKnossos now remembers the tool that was active in between disabling and enabling the segmentation layer. [#6362](https://github.com/scalableminds/webknossos/pull/6362)
- The Add Dataset view now hosts an Add Zarr Dataset tab to explore, configure and import remote Zarr datasets. [#6335](https://github.com/scalableminds/webknossos/pull/6335)
- Added a UI to manage Zarr links for an annotation so that the annotation can be streamed to third-party tools. This change also includes new backend API routes for using the (private) zarr links to annotations as well as creating them. [#6367](https://github.com/scalableminds/webknossos/pull/6367)

### Added
- Segmentation layers which were not previously editable now show an (un)lock icon button which shortcuts to the Add Volume Layer modal with the layer being preselected. [#6330](https://github.com/scalableminds/webknossos/pull/6330)
- The NML file in volume annotation download now includes segment metadata like names and anchor positions. [#6347](https://github.com/scalableminds/webknossos/pull/6347)
- Added new backend API route for requesting all publications. Those publications can now have also attached annotations. [#6315](https://github.com/scalableminds/webknossos/pull/6315)
- Added a "duplicate" button for annotations. [#6386](https://github.com/scalableminds/webknossos/pull/6386)
- Added new filter options for the dataset list api at `api/datasets`: `organizationName: String`, `onlyMyOrganization: Boolean`, `uploaderId: String` [#6377](https://github.com/scalableminds/webknossos/pull/6377)

### Changed
- webKnossos uses WebGL 2 instead of WebGL 1 now. In case your browser/hardware does not support this, webKnossos will alert you and you need to upgrade your system. [#6350](https://github.com/scalableminds/webknossos/pull/6350)
- The sharing modal now automatically saves changes of the sharing options. [#6314](https://github.com/scalableminds/webknossos/pull/6314)
- The Layers tab now displays an Add Skeleton Annotation Layer button with which volume-only annotations can be converted to hybrid annotations. [#6330](https://github.com/scalableminds/webknossos/pull/6330)
- The Zarr directory listings no longer include the current directory “.”. [6359](https://github.com/scalableminds/webknossos/pull/6359)
- The default name for volume annotation layers with fallback segmentations is now set to the name of their fallback segmentation layer, no longer “Volume”. [#6373](https://github.com/scalableminds/webknossos/pull/6373)
- The “reload data” button for dataset and annotation layers is now only shown to users who have administrative permissions for the dataset (because the button clears server caches and file handles). [#6380](https://github.com/scalableminds/webknossos/pull/6380)
- Requests for missing chunks in zarr datasets now return status code 404 instead of 200 with an empty response. [#6381](https://github.com/scalableminds/webknossos/pull/6381)
- Dataset layer thumbnails now by default show the center of the intersection of all layer bounding boxes, so all layer thumbnails show the same region. [6411](https://github.com/scalableminds/webknossos/pull/6411)

### Fixed
- Fixed a regression where the mapping activation confirmation dialog was never shown. [#6346](https://github.com/scalableminds/webknossos/pull/6346)
- Fixed an error if multiple proofreading actions were performed in rapid succession. If webKnossos is busy, inputs to the viewports are disabled from now on. [#6325](https://github.com/scalableminds/webknossos/pull/6325)
- Fixed that ad-hoc meshing would terminate early for large segments. [#6352](https://github.com/scalableminds/webknossos/pull/6352)
- Fixed a bug where the largestSegmentId of zarr segmentation layers was not propagated from the datasource-properties.json, which broke annotating based on these layers. [#6363](https://github.com/scalableminds/webknossos/pull/6363)
- Fixed a bug where uploads of wkw datasets with numerical-only layer names would fail. [#6382](https://github.com/scalableminds/webknossos/pull/6382)
- Public datasets of other organizations are no longer listed during task creation. [#6377](https://github.com/scalableminds/webknossos/pull/6377)
- Tightened organization isolation security for dataset uploads. [#6378](https://github.com/scalableminds/webknossos/pull/6378)
- Fixed a bug with undo/redo and volume interpolation/extrusion. [#6403](https://github.com/scalableminds/webknossos/pull/6403)
- Fixed a regression which caused that uint16 and uint8 segmentations could not be rendered. [#6406](https://github.com/scalableminds/webknossos/pull/6406)
- Fixed a bug which prevented keyboard shortcuts from taking affect after expanding/collapsing the sidebar panels using the button icons.[#6410](https://github.com/scalableminds/webknossos/pull/6410)
- Fixed a bug with the clip histogram button to prevent it from showing a loading spinner forever in some cases. [#6407](https://github.com/scalableminds/webknossos/pull/6407)
- Fixed an issue whereby a warning toast would be triggered every time the 3D viewport is put into fullscreen mode. [#6412](https://github.com/scalableminds/webknossos/pull/6412)

### Removed
- The Annotation Type label was removed from the info tab. [#6330](https://github.com/scalableminds/webknossos/pull/6330)
- Removed the possibility to load data from foreign webKnossos datastores. Use Zarr streaming instead. [#6392](https://github.com/scalableminds/webknossos/pull/6392)

## [22.08.0](https://github.com/scalableminds/webknossos/releases/tag/22.08.0) - 2022-07-20
[Commits](https://github.com/scalableminds/webknossos/compare/22.07.0...22.08.0)

### Highlights
- Merged the "Shared Annotations" tab into the "Annotations" tab in the user's dashboard. If annotations are shared with you, you can see them in your dashboard. The table can be filtered by owner if you prefer to see only your own annotations. [#6230](https://github.com/scalableminds/webknossos/pull/6230)
- Add new backend API routes for working with annotations without having to provide a 'type' argument. Note that these support stored annotations (Task and Explorational), but do not work for CompoundTask/CompoundProject/CompoundTaskType annotations. For the latter, please use the original route variants with explicit type. [#6285](https://github.com/scalableminds/webknossos/pull/6285)

### Added
- Added a warning for invalid volume layer names. The layer names must now be unique among all layers in an annotation and must not contain url encoded special characters. [#6289](https://github.com/scalableminds/webknossos/pull/6289)
- Added optional mappingName parameter to `requestRawCuboid` datastore route, which allows to directly apply a specified mapping in the backend. [#6311](https://github.com/scalableminds/webknossos/pull/6311)
- Added option to use `X-Auth-Token` header instead of query parameter in every datastore and tracingstore route. [#6312](https://github.com/scalableminds/webknossos/pull/6312)

### Changed
- Changed the name of the volume annotation layer in tasks to be "Volume" instead of "Volume Layer". [#6321](https://github.com/scalableminds/webknossos/pull/6321)
- Dataset managers are now allowed to change dataset team permissions for all teams they are a member of. [#6336](https://github.com/scalableminds/webknossos/pull/6336)

### Fixed
- Fixed that zooming out for datasets with very large scale was not possible until the coarsest level. [#6304](https://github.com/scalableminds/webknossos/pull/6304)

## [22.07.0](https://github.com/scalableminds/webknossos/releases/tag/22.07.0) - 2022-06-28
[Commits](https://github.com/scalableminds/webknossos/compare/22.06.1...22.07.0)

### Highlights
- Added a image data download speed indicator to the statusbar. On hover a tooltip is shown that show the total amount of downloaded shard data. [#6269](https://github.com/scalableminds/webknossos/pull/6269)
- Provide a UI to download/export a dataset in view-mode. The UI explains how to access the data with the python library. [#6283](https://github.com/scalableminds/webknossos/pull/6283)

### Added
- Added a warning for when the resolution in the XY viewport on z=1-downsampled datasets becomes too low, explaining the problem and how to mitigate it. [#6255](https://github.com/scalableminds/webknossos/pull/6255)
- Added the possibility to view and download older versions of read-only annotations. [#6274](https://github.com/scalableminds/webknossos/pull/6274)
- Added a proofreading tool which can be used to edit agglomerate mappings. After activating an agglomerate mapping the proofreading tool can be selected. While the tool is active, agglomerates can be clicked to load their agglomerate skeletons. Use the context menu to delete or create edges for those agglomerate skeletons to split or merge agglomerates. The changes will immediately reflect in the segmentation and meshes. [#6195](https://github.com/scalableminds/webknossos/pull/6195)

### Changed
- For the api routes that return annotation info objects, the user field was renamed to owner. User still exists as an alias, but will be removed in a future release. [#6250](https://github.com/scalableminds/webknossos/pull/6250)
- Slimmed the URLs for annotations by removing `Explorational` and `Task`. The old URLs are still supported, but will be redirected to the new format. [#6208](https://github.com/scalableminds/webknossos/pull/6208)
- When creating a task from a base annotation, the starting position/rotation and bounding box as specified during task creation are now used and overwrite the ones from the original base annotation. [#6249](https://github.com/scalableminds/webknossos/pull/6249)
- Increased maximum interpolation depth from 8 to 100. [#6292](https://github.com/scalableminds/webknossos/pull/6292)

### Fixed
- Fixed that bounding boxes were deletable in read-only tracings although the delete button was disabled. [#6273](https://github.com/scalableminds/webknossos/pull/6273)
- Fixed that (old) sharing links with tokens did not work, because the token was removed during a redirection. [#6281](https://github.com/scalableminds/webknossos/pull/6281)

## [22.06.1](https://github.com/scalableminds/webknossos/releases/tag/22.06.1) - 2022-06-16
[Commits](https://github.com/scalableminds/webknossos/compare/22.06.0...22.06.1)

### Fixed
- Fixed that the context menu broke webKnossos when opening it in dataset-view-mode while no segmentation layer was visible. [#6259](https://github.com/scalableminds/webknossos/pull/6259)
- Fixed benign error toast when viewing a public annotation without being logged in. [#6271](https://github.com/scalableminds/webknossos/pull/6271)

## [22.06.0](https://github.com/scalableminds/webknossos/releases/tag/22.06.0) - 2022-05-27
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.1...22.06.0)

### Highlights
- Added a volume interpolation feature. When triggering the interpolation, the current segment id is interpolated between the current slice and the slice which was annotated last. Note that the feature is forbidden for tasks by default, but can be enabled/recommended. The feature can be used via a button in the toolbar or via the shortcut V. [#6162](https://github.com/scalableminds/webknossos/pull/6162) and [#6235](https://github.com/scalableminds/webknossos/pull/6235)
- Removed the feature to copy a segment from the previous/next slice with the V shortcut. Use the new volume interpolation feature instead (also bound to V and available via the toolbar). [#6235](https://github.com/scalableminds/webknossos/pull/6235)
- Selecting "Download" from the annotation actions now opens a new modal, which lets the user select data for download, start TIFF export jobs or copy code snippets to get started quickly with the webKonossos Python Client. [#6171](https://github.com/scalableminds/webknossos/pull/6171)
- Added a long-running job that materializes annotations as datasets. It merges volume annotations with their base segmentation layer and it applies “merger mode” annotations, allowing to agglomerate segments. Access this feature from the layers sidebar. When merger mode is active, an additional button is shown in the tool bar. [#6086](https://github.com/scalableminds/webknossos/pull/6086)

### Added
- Added a batching mechanism to the task creation via NML to support uploading more than 100 NMLs at a time. [#6216](https://github.com/scalableminds/webknossos/pull/6216)
- Added support to stream zarr files using the corresponding [zarr spec](https://zarr.readthedocs.io/en/stable/spec/v2.html#storage). [#6144](https://github.com/scalableminds/webknossos/pull/6144)
- Added support to stream volume annotations as a zarr data set. [#6203](https://github.com/scalableminds/webknossos/pull/6203)
- Added segmentation layers to the functionality catching the case that more layers are active that the hardware allows. This prevents rendering issue with more than one segmentation layer and multiple color layers. [#6211](https://github.com/scalableminds/webknossos/pull/6211)
- Adding a New Volume Layer via the left border tab now gives the option to restrict resolutions for the new layer. [#6229](https://github.com/scalableminds/webknossos/pull/6229)
- Added Route to get OME-NGFF Headers for a data layer (.zattrs file) following the corresponding [spec](https://ngff.openmicroscopy.org/latest/). [#6226](https://github.com/scalableminds/webknossos/pull/6226)
- Added Route to get OME-NGFF Headers for Volume annotation. [#6242](https://github.com/scalableminds/webknossos/pull/6242)

### Changed
- When creating a new annotation with a volume layer (without fallback) for a dataset which has an existing segmentation layer, the original segmentation layer is still listed (and viewable) in the left sidebar. Earlier versions simply hid the original segmentation layer. [#6186](https://github.com/scalableminds/webknossos/pull/6186)
- Changing the visibility of a layer within an annotation does not change the visibility of the layer when viewing the corresponding dataset. [#6186](https://github.com/scalableminds/webknossos/pull/6186)
- While viewing tracings in read-only mode, the options to manipulate the tracing are now disabled. This leads to less confusion as previously the input was silently discarded. [#6140](https://github.com/scalableminds/webknossos/pull/6140).
- Changed default of `dynamicSpaceDirection` property to false to avoid confusion. [#6162](https://github.com/scalableminds/webknossos/pull/6162)
- Changed the internal protocol for requesting image data. The zoomStep parameter has been replaced by mag. This increases the datastore API version to 2.0 [#6159](https://github.com/scalableminds/webknossos/pull/6159)
- In annotation list in dashboard, replaced the non-standard word “Trace” by “Open”. [#6191](https://github.com/scalableminds/webknossos/pull/6191)
- Tiff export via webknossos-worker is now allowed for all datasets that a (logged-in) user can see, no longer only for datasets of their own organization. [#6219](https://github.com/scalableminds/webknossos/pull/6219)

### Fixed
- Fixed a bug in the task creation, where creation for some tasks with initial volume data would fail. [#6178](https://github.com/scalableminds/webknossos/pull/6178)
- Fixed a rendering bug which could cause an incorrect magnification to be rendered in rare scenarios. [#6029](https://github.com/scalableminds/webknossos/pull/6029)
- Fixed a bug which could cause a segmentation layer's "ID mapping" dropdown to disappear. [#6215](https://github.com/scalableminds/webknossos/pull/6215)
- Fixed the 3d viewport for datasets with low voxel resolution by making the camera far clipping adaptive to the dataset extent. [#6221](https://github.com/scalableminds/webknossos/pull/6221).
- Fixed a non-critical error message when resizing the browser window while webKnossos loaded a dataset or annotation. [#6247](https://github.com/scalableminds)

## [22.05.1](https://github.com/scalableminds/webknossos/releases/tag/22.05.1) - 2022-04-29
[Commits](https://github.com/scalableminds/webknossos/compare/22.05.0...22.05.1)

### Fixed
- Fixed applying recommended settings when starting a task which provides recommended settings. [#6175](https://github.com/scalableminds/webknossos/pull/6175)

### Removed
 - Removed the option to download sample-datasets. To explore webKnossos, use the public sample datasets on webknossos.org. [#6151](https://github.com/scalableminds/webknossos/pull/6151)

### Breaking Changes


## [22.05.0](https://github.com/scalableminds/webknossos/releases/tag/22.05.0) - 2022-04-26
[Commits](https://github.com/scalableminds/webknossos/compare/22.04.0...22.05.0)

### Highlights
- The mouse cursor now changes appearance to indicate the currently selected annotation tool  [#6132](https://github.com/scalableminds/webknossos/pull/6132)

### Changed
- Various changes to the Dataset table in the dashboard  [#6131](https://github.com/scalableminds/webknossos/pull/6131):
  - Renamed "Allowed Teams" column to "Access Permissions".
  - Add filter functionality to "Access Permissions" column to filter for public datasets.
  - Removed `isActive` and `isPublic` columns to save screen space.
  - Changed data layer entries to display layer names instead of categories, e.g. "color" --> "axons".
- Moved the list of "user with access to the selected dataset" from the dashboard to the respective dataset's settings (Sharing Tab). [#6166](https://github.com/scalableminds/webknossos/pull/6166)
- Sped up initial requests for remote zarr dataset by using asynchronous caching. [#6165](https://github.com/scalableminds/webknossos/pull/6165)

### Fixed
- Fixed a bug that led to an error when drag-'n'-dropping an empty volume annotation in the dataset view. [#6116](https://github.com/scalableminds/webknossos/pull/6116)
- Fixed rare callstack overflow when annotating large areas. [#6076](https://github.com/scalableminds/webknossos/pull/6076)
- Fixed the "Copy Slice" shortcut (`v` and `shift + v`) in resolutions other than the most detailed one. [#6130](https://github.com/scalableminds/webknossos/pull/6130)
- Fixed a bug where dataset tags with spaces would be automatically wrapped in quotes. [#6159](https://github.com/scalableminds/webknossos/pull/6159)
- Fixed a bug where during dataset upload, un-sorted anisotropic mags in the datasource-properties.json could lead to errors. [#6167](https://github.com/scalableminds/webknossos/pull/6167)

### Removed
- Removed the functionality to unlink the fallback layer from an existing segmentation layer. Either create an annotation without fallback layer or from within an annotation with a fallback layer, create a new volume layer, instead. [#6146](https://github.com/scalableminds/webknossos/pull/6146)

### Breaking Changes


## [22.04.0](https://github.com/scalableminds/webknossos/releases/tag/22.04.0) - 2022-03-22
[Commits](https://github.com/scalableminds/webknossos/compare/22.03.0...22.04.0)

### Highlights
- The visible meshes are now included in the link copied from the "Share" modal or the "Share" button next to the dataset position. They are automatically loaded for users that open the shared link. [#5993](https://github.com/scalableminds/webknossos/pull/5993)
- Added a new "Connectome Tab" which can be used to explore connectomes by visualizing neurites and their synaptic connections. Connectome files need to be placed in a `connectomes` folder inside of the respective segmentation layer. It is possible to craft links that automatically load specific agglomerates and their synapses when opened. For more information refer to https://docs.webknossos.org/webknossos/sharing/annotation_sharing.html#sharing-link-format. [#5894](https://github.com/scalableminds/webknossos/pull/5894)

### Added
- Added a context-menu option when right-clicking on skeleton trees to hide/show all other trees but the selected one. Great for inspecting a single tree in isolation. Identical to keyboard shortcut "2". [#6102](https://github.com/scalableminds/webknossos/pull/6102)
- Added support for reading Zarr image data. [#6019](https://github.com/scalableminds/webknossos/pull/6019)

### Changed
- The maximum brush size now depends on the available magnifications. Consequently, one can use a larger brush size when the magnifications of a volume layer are restricted. [#6066](https://github.com/scalableminds/webknossos/pull/6066)
- Improved stability and speed of volume annotations when annotating large areas. [#6055](https://github.com/scalableminds/webknossos/pull/6055)
- In dataset upload, linking layers of existing datasets is no longer restricted to public datasets. [#6097](https://github.com/scalableminds/webknossos/pull/6097)
- Deactivating users with currently active tasks is no longer allowed. [#6099](https://github.com/scalableminds/webknossos/pull/6099)

### Fixed
- Fixed a bug that led to crashing the layer settings once the icon for the downsample modal was clicked. [#6058](https://github.com/scalableminds/webknossos/pull/6058)
- Fixed a bug where toggling between not archived and archived annotations in the "My Annotation" of the dashboard led to inconsistent states and duplicates of annotations. [#6058](https://github.com/scalableminds/webknossos/pull/6058)
- Fixed a bug where deactivated users would still be listed as allowed to access the datasets of their team. [#6070](https://github.com/scalableminds/webknossos/pull/6070)
- Fixed occasionally "disappearing" data. [#6055](https://github.com/scalableminds/webknossos/pull/6055)
- Fixed a bug where remote-origin headers were omitted in error case. [#6098](https://github.com/scalableminds/webknossos/pull/6098)
- Increased the timeouts for some internal operations like downsampling volume annotations. [#6103](https://github.com/scalableminds/webknossos/pull/6103)
- Fixed a bug where there was a suggested change in the `datasource-config.json` was shown for resolution `1` instead of `[1,1,1]` or vice-versa. [#6104](https://github.com/scalableminds/webknossos/pull/6104)

### Removed
- The previously disabled Import Skeleton Button has been removed. The functionality is available via the context menu for datasets with active ID mappings. [#6073](https://github.com/scalableminds/webknossos/pull/6073)
- Removes experimental (and hidden) automatic brushing feature. Consequently, the corresponding feature flag `autoBrushReadyDatasets` is not used, anymore. [#6107](https://github.com/scalableminds/webknossos/pull/6107)

### Breaking Changes


## [22.03.0](https://github.com/scalableminds/webknossos/releases/tag/22.03.0) - 2022-02-21
[Commits](https://github.com/scalableminds/webknossos/compare/22.02.0...22.03.0)

### Highlights
- Added experimental min-cut feature to split a segment in a volume annotation with two seeds. [#5885](https://github.com/scalableminds/webknossos/pull/5885)
- Added a button next to the histogram which adapts the contrast and brightness to the currently visible data. [#5961](https://github.com/scalableminds/webknossos/pull/5961)
- Viewport scale bars are now dynamically adjusted to display sensible values. [#5418](https://github.com/scalableminds/webknossos/pull/6034)

### Added
- Added the option to make a segment's ID active via the right-click context menu in the segments list. [#5935](https://github.com/scalableminds/webknossos/pull/6006)
- Running uploads can now be cancelled. [#5958](https://github.com/scalableminds/webknossos/pull/5958)
- Annotations with multiple volume layers can now be uploaded. (Note that merging multiple annotations with multiple volume layers each is not supported.) [#6028](https://github.com/scalableminds/webknossos/pull/6028)
- Decrease volume annotation download latency by using a different compression level. [#6036](https://github.com/scalableminds/webknossos/pull/6036)

### Changed
- Upgraded webpack build tool to v5 and all other webpack related dependencies to their latest version. Enabled persistent caching which speeds up server restarts during development as well as production builds. [#5969](https://github.com/scalableminds/webknossos/pull/5969)
- Improved stability when quickly volume-annotating large structures. [#6000](https://github.com/scalableminds/webknossos/pull/6000)
- The front-end API `labelVoxels` returns a promise now which resolves as soon as the label operation was carried out. [#5955](https://github.com/scalableminds/webknossos/pull/5955)
- webKnossos no longer tries to reach a save state where all updates are sent to the backend to be in sync with the frontend when the save is triggered by a timeout. [#5999](https://github.com/scalableminds/webknossos/pull/5999)
- When changing which layers are visible in an annotation, this setting is persisted in the annotation, so when you share it, viewers will see the same visibility configuration. [#5967](https://github.com/scalableminds/webknossos/pull/5967)
- Downloading public annotations is now also allowed without being authenticated. [#6001](https://github.com/scalableminds/webknossos/pull/6001)
- Downloaded volume annotation layers no longer produce zero-byte zipfiles but rather a valid header-only zip file with no contents. [#6022](https://github.com/scalableminds/webknossos/pull/6022)
- Changed a number of API routes from GET to POST to avoid unwanted side effects. [#6023](https://github.com/scalableminds/webknossos/pull/6023)
- Removed unused datastore route `checkInbox` (use `checkInboxBlocking` instead). [#6023](https://github.com/scalableminds/webknossos/pull/6023)
- Migrated to Google Analytics 4. [#6031](https://github.com/scalableminds/webknossos/pull/6031)

### Fixed
- Fixed volume-related bugs which could corrupt the volume data in certain scenarios. [#5955](https://github.com/scalableminds/webknossos/pull/5955)
- Fixed the placeholder resolution computation for anisotropic layers with missing base resolutions. [#5983](https://github.com/scalableminds/webknossos/pull/5983)
- Fixed a bug where ad-hoc meshes were computed for a mapping, although it was disabled. [#5982](https://github.com/scalableminds/webknossos/pull/5982)
- Fixed a bug where volume annotation downloads would sometimes contain truncated zips. [#6009](https://github.com/scalableminds/webknossos/pull/6009)
- Fixed a bug where downloaded multi-layer volume annotations would have the wrong data.zip filenames. [#6028](https://github.com/scalableminds/webknossos/pull/6028)
- Fixed a bug which could cause an error message to appear when saving. [#6052](https://github.com/scalableminds/webknossos/pull/6052)


## [22.02.0](https://github.com/scalableminds/webknossos/releases/tag/22.02.0) - 2022-01-24
[Commits](https://github.com/scalableminds/webknossos/compare/22.01.0...22.02.0)

### Highlights
- Added the possibility to add additional volume layers to an existing annotation via the left sidebar. [#5881](https://github.com/scalableminds/webknossos/pull/5881)

### Added
- Added a warning when navigating away from editing the dataset's properties without having saved. [#5948](https://github.com/scalableminds/webknossos/pull/5948)
- Tiff exports are now served from the datastore module to prepare for remote datastores with webknossos-worker. [#5942](https://github.com/scalableminds/webknossos/pull/5942)
- Added the organization id to the auth token page and organization page. [#5965](https://github.com/scalableminds/webknossos/pull/5965)
- Added the possibility to cancel running webknossos-worker jobs. [#5946](https://github.com/scalableminds/webknossos/pull/5946)
- Partially executed floodfills can now be finished by starting a worker job from the bounding box tab (requires a webKnossos instance where jobs are set up). [#5905](https://github.com/scalableminds/webknossos/pull/5905)

### Changed
- Improved the UI for automatic suggestions to the datasource properties when editing a dataset. [#5948](https://github.com/scalableminds/webknossos/pull/5948)

### Fixed
- Fixed bug where volume data downloads would sometimes produce invalid zips due to a race condition. [#5926](https://github.com/scalableminds/webknossos/pull/5926)
- Fixed a bug which caused that the keyboard delay wasn't respected properly when rapidly pressing a key. [#5947](https://github.com/scalableminds/webknossos/pull/5947)
- Fixed that navigating away from uploading a dataset properly warns the user that there is unsaved state. [#5948](https://github.com/scalableminds/webknossos/pull/5948)
- Fixed a bug where an organization would be created for an already existing email address. [#5949](https://github.com/scalableminds/webknossos/pull/5949)
- Fixed a bug where the paths of uploaded files were not checked correctly. [#5950](https://github.com/scalableminds/webknossos/pull/5950)
- Fixed that the used datastore could not be changed in the UI when uploading a dataset. [#5952](https://github.com/scalableminds/webknossos/pull/5952)
- Fixed the context menu positioning at the bottom and right edges of the screen. [#5976](https://github.com/scalableminds/webknossos/pull/5976)

### Removed

### Breaking Changes


## [22.01.0](https://github.com/scalableminds/webknossos/releases/tag/22.01.0) - 2022-01-04
[Commits](https://github.com/scalableminds/webknossos/compare/21.11.2...22.01.0)

### Highlights
- Added tagging support for datasets. [#5832](https://github.com/scalableminds/webknossos/pull/5832)

### Added
- Dataset upload back-end now supports linking layers of existing public datasets. [#5863](https://github.com/scalableminds/webknossos/pull/5863)
- Activate the correct mapping before loading pre-computed meshes if the corresponding mesh file contains that information. [#5859](https://github.com/scalableminds/webknossos/pull/5859)

### Fixed
- Fixed a bug where dataset uploads that contained files larger than 2 GB failed. [#5889](https://github.com/scalableminds/webknossos/pull/5889)
- Fixed that dataset uploads did not survive back-end restarts. [#5831](https://github.com/scalableminds/webknossos/pull/5831)
- Fixed a bug where NMLs with unconnected trees and nested tree groups could not be uploaded due to wrong tree group IDs. [#5893](https://github.com/scalableminds/webknossos/pull/5893)
- Fixed a security vulnerability by upgrading log4j to the newest version. [#5900](https://github.com/scalableminds/webknossos/pull/5900)

### Breaking Change
- When using the front-end API, functions that accept a layer name, such as `api.data.getDataValue`, won't interpret the name "segmentation" as the current volume tracing if it exists. Instead, "segmentation" can only be used if the current dataset has a layer which is named "segmentation". If you want to interact with the volume tracing layer, use `api.data.getVolumeTracingLayerIds()` instead. Also see `api.data.getSegmentationLayerNames` and `api.data.getVisibleSegmentationLayer`. [#5771](https://github.com/scalableminds/webknossos/pull/5771)
- The datastore server routes `/datasets/reserveUpload` and `/datasets/finishUpload` now expect the additional field `layersToLink`, which should be an empty list by default. [#5863](https://github.com/scalableminds/webknossos/pull/5863)


## [21.11.2](https://github.com/scalableminds/webknossos/releases/tag/21.11.2) - 2021-12-21
[Commits](https://github.com/scalableminds/webknossos/compare/21.11.1...21.11.2)

### Fixed
- Fixed a security vulnerability by upgrading log4j to newest version (2.17.0). [#5913](https://github.com/scalableminds/webknossos/pull/5913)

## [21.11.1](https://github.com/scalableminds/webknossos/releases/tag/21.11.1) - 2021-12-16
[Commits](https://github.com/scalableminds/webknossos/compare/21.11.0...21.11.1)

### Fixed
- Fixed a security vulnerability by upgrading log4j to newest version (2.15.0). [#5900](https://github.com/scalableminds/webknossos/pull/5900)

## [21.11.0](https://github.com/scalableminds/webknossos/releases/tag/21.11.0) - 2021-11-30
[Commits](https://github.com/scalableminds/webknossos/compare/21.10.0...21.11.0)

### Highlights
- Added a new bounding box tool that allows resizing and creating bounding boxes more easily. Additionally, the context menu now contains options to modify the bounding box close to the clicked position. [#5767](https://github.com/scalableminds/webknossos/pull/5767)

### Changed
- The docker setup has been restructured, which requires changes to existing docker-compose setups. See the migration guide for details. [#5843](https://github.com/scalableminds/webknossos/pull/5843)
- By default, if data is missing in one magnification, higher magnifications are used for rendering. This setting can be controlled via the left sidebar under "Render Missing Data Black". [#5862](https://github.com/scalableminds/webknossos/pull/5862)
- Made the `w` shortcut to cycle through the tools non-looping. [#5865](https://github.com/scalableminds/webknossos/pull/5865)
- The communication with webknossos-worker for long-running jobs no longer uses flower/celery, but instead webKnossos itself assigns jobs to polling workers. [#5834](https://github.com/scalableminds/webknossos/pull/5834)

### Fixed
- Fixed a bug that the displayed value range of a histogram of a color layer wasn't applied until the slider was dragged a bit. [#5853](https://github.com/scalableminds/webknossos/pull/5853)
- Fixed a bug where admins could not share annotations with teams they were not explicitly a member of. [#5845](https://github.com/scalableminds/webknossos/pull/5845)

### Removed
- Removed `1` shortcut which allowed to cycle through the tools but only if some of the tools were active. Use `w` instead. [#5865](https://github.com/scalableminds/webknossos/pull/5865)

## [21.10.0](https://github.com/scalableminds/webknossos/releases/tag/21.10.0) - 2021-11-08
[Commits](https://github.com/scalableminds/webknossos/compare/21.09.0...21.10.0)

### Highlights
- A new "Segments" tab was added which replaces the old "Meshes" tab. The tab renders a list of segments within a volume annotation for the visible segmentation layer. The list "grows" while creating an annotation or browsing a dataset. For example, selecting an existing segment or drawing with a new segment id will both ensure that the segment is listed. Via right-click, meshes can be loaded for a selected segment. The mesh will be added as child to the segment. [#5696](https://github.com/scalableminds/webknossos/pull/5696)
- Enhanced the volume fill tool to so that it operates beyond the dimensions of the current viewport. Additionally, the fill tool can also be changed to perform in 3D instead of 2D. [#5733](https://github.com/scalableminds/webknossos/pull/5733)
- The active mapping is now included in the link copied from the "Share" modal or the new "Share" button next to the dataset position. It is automatically activated for users that open the shared link. [#5738](https://github.com/scalableminds/webknossos/pull/5738)

### Added
- Added the possibility to load the skeletons of specific agglomerates from an agglomerate file when opening a tracing by including a mapping and agglomerate ids in the URL hash. See the [docs](https://docs.webknossos.org/webknossos/sharing/annotation_sharing.html#sharing-link-format) for further information. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
- Added a skeleton sandbox mode where a dataset can be opened and all skeleton tracing capabilities are available. However, by default changes are not saved. At any point, users can decide to copy the current state to their account. The sandbox can be accessed at `<webknossos_host>/datasets/<organization>/<dataset>/sandbox/skeleton`. In the combination with the new agglomerate skeleton loading feature this can be used to craft links that open webknossos with an activated mapping and specific agglomerates loaded on-demand. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
- For ad-hoc mesh computation and for mesh precomputation, the user can now select which quality the mesh should have (i.e., via selecting which magnification should be used). [#5696](https://github.com/scalableminds/webknossos/pull/5696)
- The context menu in the data viewport also allows to compute an ad-hoc mesh for the selected segment. [#5696](https://github.com/scalableminds/webknossos/pull/5696)

### Changed
- Improved the movement behavior when using shortcuts to navigate along the 3rd dimension. Instead of clamping the sub-voxel position to .0 or .99 on the initial movement, the keyboard delay is adapted dynamically to avoid too fast movements. This change especially improves the move behavior when quickly changing the direction backwards/forwards. [#5801](https://github.com/scalableminds/webknossos/pull/5801)

### Fixed
- Fixed two volume tracing related bugs which could occur when using undo with a slow internet connection or when volume-annotating more than 5000 buckets (32**3 vx) in one session. [#5728](https://github.com/scalableminds/webknossos/pull/5728)
- Jobs status is no longer polled if jobs are not enabled, avoiding backend logging spam [#5761](https://github.com/scalableminds/webknossos/pull/5761)
- Fixed a bug that windows user could not open the context menu as it instantly closed after opening. [#5756](https://github.com/scalableminds/webknossos/pull/5756).
- Fixed a bug where the health check of public datasets failed if no cookie/token was supplied. [#5768](https://github.com/scalableminds/webknossos/pull/5768).
- Fixed a bug where retried save requests could lead to a 409 CONFLICT error if the first request was already handled by the back-end. [#5779](https://github.com/scalableminds/webknossos/pull/5779).
- Fixed a bug where volume annotations could not be saved under certain circumstances (if "Render Missing Data Black" was disabled and a data bucket was annotated for the first time). [#5783](https://github.com/scalableminds/webknossos/pull/5783)
- Fixed a bug which made the ad-hoc mesh loading abort too early. [#5696](https://github.com/scalableminds/webknossos/pull/5696)
- Fixed that viewports turned black when zoomed in very much. [#5797](https://github.com/scalableminds/webknossos/pull/5797)
- Fixed the bucket loading order in the YZ and XZ viewports. Data in these viewports will be rendered faster than before. [#5798](https://github.com/scalableminds/webknossos/pull/5798)
- Fixed that collapsing/expanding the sidebars did not work for touchscreens. [#5825](https://github.com/scalableminds/webknossos/pull/5825)
- Fixed a bug where projects could not be listed if the tracing time got too large. [#5823](https://github.com/scalableminds/webknossos/pull/5823)

## [21.09.0](https://github.com/scalableminds/webknossos/releases/tag/21.09.0) - 2021-10-01
[Commits](https://github.com/scalableminds/webknossos/compare/21.08.0...21.09.0)

### Highlights
- Added shortcuts K and L for toggling the left and right sidebars. [#5709](https://github.com/scalableminds/webknossos/pull/5709)
- Added support for datasets that have multiple segmentation layers. Note that only one segmentation layer can be rendered at a time, currently. [#5683](https://github.com/scalableminds/webknossos/pull/5683)

### Added
- Added a rudimentary version of openAPI docs for some routes. Available at `/swagger.json`. [#5693](https://github.com/scalableminds/webknossos/pull/5693)

### Changed
- By default, if data is missing in one magnification, higher magnifications are used for rendering. This setting can be controlled via the left sidebar under "Render Missing Data Black". [#5703](https://github.com/scalableminds/webknossos/pull/5703)
- Refactor the format of the URL hash/fragment to alternatively use JSON. Old links will continue to work. [#5730](https://github.com/scalableminds/webknossos/pull/5730)

### Fixed
- Fixed a bug where existing tasktypes with recommended configurations still had a property that is no longer valid. [#5707](https://github.com/scalableminds/webknossos/pull/5707)
- Fixed that segment IDs could not be copied to the clipboard. [#5709](https://github.com/scalableminds/webknossos/pull/5709)
- Fixed a bug where volume annotation version restore skipped buckets that were not yet touched in the version to be restored. [#5717](https://github.com/scalableminds/webknossos/pull/5717)
- Fixed a rendering bug showing non-existent or wrongly-colored edges that sometimes occurred after deleting edges, nodes, or trees. [#5724](https://github.com/scalableminds/webknossos/pull/5724)
- Fixed an error during viewport maximization in flight mode. Also, fixed a crash during minimization of the 3D-View for datasets with lots of magnifications. [#5746](https://github.com/scalableminds/webknossos/pull/5746)

## [21.08.0](https://github.com/scalableminds/webknossos/releases/tag/21.08.0) - 2021-08-26
[Commits](https://github.com/scalableminds/webknossos/compare/21.07.0...21.08.0)

### Highlights
- Added the possibility to restrict the volume resolutions when creating explorative annotations. Use this to annotate larger structures without creating tons of high-res data. [#5645](https://github.com/scalableminds/webknossos/pull/5645)
- Most recent dataset conversions are shown in dashboard (if the webKnossos instance supports processing jobs). [#5597](https://github.com/scalableminds/webknossos/pull/5597)
- Added UI to infer nuclei for webknossos instances that support jobs (e.g., webknossos.org). [#5669](https://github.com/scalableminds/webknossos/pull/5669)

### Added
- Fixed a bug where non-existing resolutions could be selected for wk-worker-based meshfile computations [#5631](https://github.com/scalableminds/webknossos/pull/5631)
- Added new mesh-related functions to the front-end API: getAvailableMeshFiles, getActiveMeshFile, setActiveMeshFile, loadPrecomputedMesh, computeMeshOnDemand, setMeshVisibility, removeMesh. [#5634](https://github.com/scalableminds/webknossos/pull/5634)
- Added a route to call new webknossos-worker job for nuclei inferral. [#5626](https://github.com/scalableminds/webknossos/pull/5626)
- Added shortcut information to the context menu. Some shortcuts that are only available for the classic controls are only shown when the classic controls are active. [#5677](https://github.com/scalableminds/webknossos/pull/5677)
- For webknossos.org, a "What's New" notification was added to the navbar. [#5665](https://github.com/scalableminds/webknossos/pull/5665)
- Added tooltips for all elements of the Settings tab in the left sidebar. [#5673](https://github.com/scalableminds/webknossos/pull/5673)

### Changed
- Improved context menu for interactions with segmentation data that wasn't loaded completely, yet. [#5637](https://github.com/scalableminds/webknossos/pull/5637)
- Any feature connected to computational jobs like precomputing a meshfile is now disabled for non local hosted datasets. [#5663](https://github.com/scalableminds/webknossos/pull/5663)
- Clicking outside of the context menu closes it without performing any other action (e.g., previously, a node could be created when clicking outside of the context menu, when the skeleton tool was active). Also, a repeated right-click doesn't open the context menu again. [#5658](https://github.com/scalableminds/webknossos/pull/5658)
- When the option "Rendering missing data black" is turned of, the fallback data is now shown up to a zoom difference of 3. Previously it was 1. [#5674](https://github.com/scalableminds/webknossos/pull/5674)

### Fixed
- Fixed that active segment and node id were not shown in status bar in a non-hybrid annotation. [#5638](https://github.com/scalableminds/webknossos/pull/5638)
- Fixed that setting an intensity range of a color layer to 0 via the histogram slider led to no data being rendered at all. [#5676](https://github.com/scalableminds/webknossos/pull/5676)
- Fixed that "Compute Mesh File" button was enabled in scenarios where it should not be supported (e.g., when no segmentation layer exists). [#5648](https://github.com/scalableminds/webknossos/pull/5648)
- Fixed a bug where an authentication error was shown when viewing the meshes tab while not logged in. [#5647](https://github.com/scalableminds/webknossos/pull/5647)
- Fixed that segment id 0 was always shown even when fallback data of the segmentation layer was visible and hovered with the mouse. [#5674](https://github.com/scalableminds/webknossos/pull/5674)
- Fixed that nodes could only be selected via the context menu when an annotation was opened in read-only mode. Shift-Click will now work, too (and if "Classic Controls" are disabled, a simple left click will work, too). [#5661](https://github.com/scalableminds/webknossos/pull/5661)
- Fixed that the copy buttons in the context menu did not work properly. [#5658](https://github.com/scalableminds/webknossos/pull/5658)
- Fixed that the position of the mouse displayed in the statusbar was not updated properly when navigating via the keyboard. [#5670](https://github.com/scalableminds/webknossos/issues/5670)
- Fixed that creating a new node in merger mode did always turn off the "Hide unmapped segments" setting. [#5668](https://github.com/scalableminds/webknossos/pull/5668)
- Fixed that undo in volume annotations might overwrite the backend data on not loaded magnifications with zeros. [#5608](https://github.com/scalableminds/webknossos/pull/5608)
- Fixed a bug where volume annotation downloads were occasionally cancelled with “Connection reset by peer” error. [#5660](https://github.com/scalableminds/webknossos/pull/5660)
- Fixed that the ad-hoc mesh computation was disabled for volume annotations. [#5689](https://github.com/scalableminds/webknossos/pull/5689)

### Breaking Change
- The interface of the cross-origin API changed. The initialization message is no longer an object with a `message` property of "api ready", but instead an object with a `type` property of "init". Additionally, if an API call finishes, a return message of type "ack" is sent. If the original API call contained a `messageId` property, the return message will contain the same `messageId` to allow to match the return message. If the API call is misformatted, a return message of `type` "err" is sent, containing an error message in the `message` property.

## [21.07.0](https://github.com/scalableminds/webknossos/releases/tag/21.07.0) - 2021-07-21
[Commits](https://github.com/scalableminds/webknossos/compare/21.06.0...21.07.0)

### Highlights
- Several improvements and changes have been implemented for the toolbar, sidebar and status bar. See the full changelog for all details (grouped under #5384). Alternatively, read the corresponding [blog post](https://medium.com/scalableminds/making-the-webknossos-ui-more-intuitive-81dd364ad70e). The most important changes are:
  - The toolbar now contains dedicated tools for moving, editing skeletons and erasing volume data.
  - Right click opens a context menu for all tools, unless "Classic Mode" is enabled in the Settings tab (left sidebar).
  - The two tabs in the left sidebar "Annotation" and "Dataset" were renamed and restructured to "Layers" and "Settings". Some elements were also moved to other areas, such as the toolbar (e.g., the merger mode) or to dedicated tabs in the right sidebar (e.g., bounding boxes).
  - The status bar contains additional elements for (editable) information, such as the active tree id (previously positioned in the left sidebar).
- Added compatibility with newer JREs, tested with 8, 11 and 14. [#5558](https://github.com/scalableminds/webknossos/pull/5558)

### Added
- Added the possibility for admins to set long-running jobs to a “manually repaired” state. [#5530](https://github.com/scalableminds/webknossos/pull/5530)
- The toolbar contains two  additional tools: [#5384](https://github.com/scalableminds/webknossos/pull/5384)
  - one for the skeleton mode (similar to the existing move tool).
  - one for erasing volume data (similar to right-dragging with the previous brush/trace tool)
- Added colored icons to the status entries in the job list. [#5572](https://github.com/scalableminds/webknossos/pull/5594)
- Back-end side analytics are now sent to events-relay.webknossos.org by default. You can opt out by setting `backendAnalytics.uri` to empty in your config. [5607](https://github.com/scalableminds/webknossos/pull/5607)

### Changed
- Improve error logging for unhandled rejections. [#5575](https://github.com/scalableminds/webknossos/pull/5575)
- Improved dragging behavior of trees/groups in the tree tab. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- "Center new Nodes" option was renamed to "Auto-center Nodes" and changed to also influence the centering-behavior when deleting a node. [#5538](https://github.com/scalableminds/webknossos/pull/5538)
- The displayed webKnossos version now omits the parent release name for intermediate builds. [#5565](https://github.com/scalableminds/webknossos/pull/5565)
- The following changes belong to [#5384](https://github.com/scalableminds/webknossos/pull/5384):
  - The move tool is only capable of performing movements (its skeleton-functionalities were moved to a dedicated skeleton tool).
  - (Unless classic mode is enabled:) Right-click opens a context-sensitive menu by default with various actions, such as creating an edge between two nodes. Consequently, important actions which were done via right click previously were changed:
      - In the skeleton tool, left click can be used to create, select and move nodes. Also, mere dragging (without hovering a node) moves the active position (similar to the move tool).
      - In the trace/brush tool, erasure cannot be performed with right click, anymore. Instead, CTRL + Shift + Left Click works for erasing. Alternatively, selecting the dedicated erase tool also works.
  - The two tabs in the left sidebar "Annotation" and "Dataset" were renamed and restructured to "Layers" and "Settings".
      - "Layers" contains the layers which were previously visible in "Dataset".
    - Also, "Layers" contains a dedicated Skeleton layer which handles skeleton-specific settings (e.g., clipping distance).
    - "Merger Mode" and "Soma Clicking" were moved to the toolbar (visible when the skeleton tool is selected).
    - “Brush Size” was moved to the toolbar (visible when brush or brush-eraser is selected)
    - "Controls" and "Viewport options" (previously under "Annotation") and "Data Rendering" (previously under "Dataset") were moved to "Settings".
    - The "Bounding Boxes" section in "Annotation" tab was moved to an own tab to the right sidebar.
    - The "Mapping" setting was moved to the segmentation layer in the left sidebar.
  - The status bar contains additional elements for (editable) information, such as the active tree id (previously positioned in the left sidebar).
  - In some UI elements, text was replaced by icons. An explaining tooltip can be shown by hovering.
- The health check at api/health does not longer include checking data/health and tracings/health if the respective local modules are enabled. Consider monitoring those routes separately. [#5601](https://github.com/scalableminds/webknossos/pull/5601)
- Improved the progress display for dataset uploads. [5616](https://github.com/scalableminds/webknossos/pull/5616)

### Fixed
- Fixed that a disabled "Center new Nodes" option didn't work correctly in merger mode. [#5538](https://github.com/scalableminds/webknossos/pull/5538)
- Fixed a bug where dataset uploads of zips with just one file inside failed. [#5534](https://github.com/scalableminds/webknossos/pull/5534)
- Fixed a benign error message when a dataset without a segmentation layer was opened in view mode or with a skeleton-only annotation. [#5583](https://github.com/scalableminds/webknossos/pull/5583)
- Fixed crashing tree tab which could happen when dragging a node and then switching directly to another tab (e.g., comments) and then back again. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed a bug that the selection of nodes in the skeleton tool was possible for nodes far behind the position and thus prevented creating new nodes. [#5624](https://github.com/scalableminds/webknossos/pull/5624)
- Fixed that the UI allowed mutating trees in the tree tab (dragging/creating/deleting trees and groups) in read-only tracings. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed "Create a new tree group for this file" setting in front-end import when a group id of 0 was used in the NML. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed a bug that caused a distortion when moving or zooming in the maximized 3d viewport. [#5550](https://github.com/scalableminds/webknossos/pull/5550)
- Fixed a bug that prevented focusing the login fields when being prompted to login after trying to view a dataset without being logged in.[#5521](https://github.com/scalableminds/webknossos/pull/5577)
- Fixed a bug that prevented the modal to export data of a bounding box to tiff files to open up. [#5624](https://github.com/scalableminds/webknossos/pull/5624)
- Fixed that the 3d view content disappeared permanently if the 3d view was resized to not be visible. [#5588](https://github.com/scalableminds/webknossos/pull/5588)
- Fixed a bug where nested tree groups were messed up during NML upload if “Create a new tree group for this file.“ is selected. [#5596](https://github.com/scalableminds/webknossos/pull/5596)

### Removed
- The following changes belong to [#5384](https://github.com/scalableminds/webknossos/pull/5384):
  - Removed "Highlight hovered cells" setting (highlight on hover will always be done).
  - The "Volume" tab was removed. The "Mapping" setting was moved to the segmentation layer in the left sidebar. The "segment id" table was removed, as the status bar also contains the information about the hovered cell id.

## [21.06.0](https://github.com/scalableminds/webknossos/releases/tag/21.06.0) - 2021-06-01
[Commits](https://github.com/scalableminds/webknossos/compare/21.05.1...21.06.0)

### Highlights
- Added the possibility to load precomputed meshes from a meshfile via the meshes tab or context menu. [#5345](https://github.com/scalableminds/webknossos/pull/5345)
- Added the option to hide the plane borders and crosshairs in the 3D viewport. Also, this setting was moved from the "Other" section of the user settings to the 3D viewport. Additionally, added a setting to hide the dataset bounding box in the 3D view. [#5440](https://github.com/scalableminds/webknossos/pull/5440)

### Added
- Added an icon to the info tab of a tracing that links to the dataset settings. It's located next to the dataset name. [#5462](https://github.com/scalableminds/webknossos/pull/5462)
- Upgraded several dependencies including Play framework to 2.8, yielding performance and security improvements. [#5515](https://github.com/scalableminds/webknossos/pull/5515)

### Changed
- Active nodes and trees are now highlighted with a background color in the comments tab. [#5461](https://github.com/scalableminds/webknossos/pull/5461)
- The visibility of meshes can now be toggled via the meshes tab. [#5346](https://github.com/scalableminds/webknossos/pull/5345)
- When exporting an user bounding box to tiff, the active mapping will now be applied to the exported data, as well. [#5474](https://github.com/scalableminds/webknossos/pull/5474)
- Changed the layout of the modal that informs the user about the success of task creations and changed the naming schema for the downloadable csv file containing the information about created tasks. [#5491](https://github.com/scalableminds/webknossos/pull/5491)

### Fixed
- Fixed that the row selection in the user table wasn't properly preserved when filtering the table and (un)selecting rows. [#5486](https://github.com/scalableminds/webknossos/pull/5486)
- Fixed a bug where histograms generation failed for tiny datasets. [#5458](https://github.com/scalableminds/webknossos/pull/5458)
- Fixed a bug where NMLs with huge tree IDs uploaded via back-end produced broken annotations. [#5484](https://github.com/scalableminds/webknossos/pull/5484)
- Fixed a bug that led to various possible inconsistencies in the dataset settings in the datasource tab, when the inferred datasource properties suggested by the backend were accepted by the user. [#5492](https://github.com/scalableminds/webknossos/pull/5492)
- Fixed a bug where the upload of multiple NMLs failed if some of them have an organization attribute and others don’t. [#5483](https://github.com/scalableminds/webknossos/pull/5483)
- Fixed a bug in the application of agglomerate files where the `cumsum.json` was not used correctly. [#5499](https://github.com/scalableminds/webknossos/pull/5499)
- Improve loading of precomputed meshes and fix some issues (e.g., deleting a mesh which was still being loaded) which could produce an invalid state. [#5519](https://github.com/scalableminds/webknossos/issues/5519)
- Fixed an innocuous error toast when opening the dataset import view. [#5526](https://github.com/scalableminds/webknossos/pull/5526)
- Fixed that creating/editing a volume task type didn't allow submitting the form. [#5532](https://github.com/scalableminds/webknossos/pull/5532)

### Removed
- Removed the button to load or refresh the isosurface of the centered cell from the 3D view. Instead, this action can be triggered from the "Meshes" tab. [#5440](https://github.com/scalableminds/webknossos/pull/5440)

## [21.05.1](https://github.com/scalableminds/webknossos/releases/tag/21.05.1) - 2021-05-05
[Commits](https://github.com/scalableminds/webknossos/compare/21.05.0...21.05.1)

### Highlights
- Added a dark theme for webKnossos. [#5407](https://github.com/scalableminds/webknossos/pull/5407)

### Changed
- The deployment configuration of webKnossos was cleaned up. If you host your own webKnossos instance, be sure to update your config according to the migration guide. [#5208](https://github.com/scalableminds/webknossos/pull/5208)

### Fixed
- Fixed a bug where users could see long-running jobs listing of other users [#5435](https://github.com/scalableminds/webknossos/pull/5435)
- Fixed a rendering bug which occurred when the initial layout had a hidden 3D viewport. [#5429](https://github.com/scalableminds/webknossos/pull/5429)
- Fixed an incorrect initial camera rotation in the 3D viewport and an incorrect initial zoom value. [#5453](https://github.com/scalableminds/webknossos/pull/5453)
- Fixed a bug where the task search showed duplicates if a user had multiple instances of a task (as made possible by the transfer functionality). [#5456](https://github.com/scalableminds/webknossos/pull/5456)
- Fixed a bug where showing active users of a project, and transferring their tasks was broken. [#5456](https://github.com/scalableminds/webknossos/pull/5456)

## [21.05.0](https://github.com/scalableminds/webknossos/releases/tag/21.05.0) - 2021-04-22
[Commits](https://github.com/scalableminds/webknossos/compare/21.04.0...21.05.0)

### Highlights
- The layout of the tracing view was revamped. Most notably, the layout now has two well-behaved sidebars (left and right) which can be collapsed and expanded while the remaining space is used for the main data view. Additionally, a status bar was added which shows important information, such as the currently rendered magnification and useful mouse controls. [#5279](https://github.com/scalableminds/webknossos/pull/5279)
- Added a screenshot of the 3D view when using the screenshot functionality in the tracing view. [#5324](https://github.com/scalableminds/webknossos/pull/5324)

### Added
- The names of Task Types and Projects no longer need to be globally unique, instead only within their respective organization.  [#5334](https://github.com/scalableminds/webknossos/pull/5334)
- Upgraded UI library antd to version 4, creating a slightly more modern look and behavior of many UI elements. [#5350](https://github.com/scalableminds/webknossos/pull/5350)
- Tiff export jobs of volume annotations now show the link back to the annotation in the jobs list. [#5378](https://github.com/scalableminds/webknossos/pull/5378)
- Added support for flight- and oblique-mode when having non-uint8 dataset layers. [#5396](https://github.com/scalableminds/webknossos/pull/5396)

### Changed
- webKnossos is now part of the [image.sc support community](https://forum.image.sc/tag/webknossos). [#5332](https://github.com/scalableminds/webknossos/pull/5332)
- Meshes that are imported by the user in the meshes tab are now rendered the same way as generated isosurface meshes. [#5326](https://github.com/scalableminds/webknossos/pull/5326)
- In the new REST API version 4, projects are no longer referenced by name, but instead by id. [#5334](https://github.com/scalableminds/webknossos/pull/5334)

### Fixed
- Fixed a bug where some values in the project list were displayed incorrectly after pausing/unpausing the project. [#5339](https://github.com/scalableminds/webknossos/pull/5339)
- Fixed that editing a task type would always re-add the default values to the recommended configuration (if enabled). [#5341](https://github.com/scalableminds/webknossos/pull/5341)
- Fixed a bug where tasks created from existing volume annotations that did not have a specified bounding box were broken. [#5362](https://github.com/scalableminds/webknossos/pull/5361)
- Fixed broken search functionality in select components. [#5394](https://github.com/scalableminds/webknossos/pull/5394)
- Fixed a bug which could cause corrupted trees when CTRL+Rightclick was used in an empty tree. [#5385](https://github.com/scalableminds/webknossos/pull/5385)
- Fixed a bug in Safari which could cause an error message (which is safe to ignore). [#5373](https://github.com/scalableminds/webknossos/pull/5373)
- Fixed artifacts in screenshots near the dataset border. [#5324](https://github.com/scalableminds/webknossos/pull/5324)
- Fixed a bug where the page would scroll up unexpectedly when showing various confirm modals. [#5371](https://github.com/scalableminds/webknossos/pull/5371)
- Fixed a bug where user changes (email, activation) would show as successful even if they actually failed. [#5392](https://github.com/scalableminds/webknossos/pull/5392)
- Fixed a bug where dataset uploads were sent to the wrong datastore, and failed. [#5404](https://github.com/scalableminds/webknossos/pull/5404)

## [21.04.0](https://github.com/scalableminds/webknossos/releases/tag/21.04.0) - 2021-03-22
[Commits](https://github.com/scalableminds/webknossos/compare/21.03.1...21.04.0)

### Highlights
- Added the possibility to upload datasets without zipping them first. [#5137](https://github.com/scalableminds/webknossos/pull/5137)
- Added CTRL+Scroll for zooming, which enables pinch-to-zoom on some trackpads. [#5224](https://github.com/scalableminds/webknossos/pull/5224)

### Added
- The time spent on a project is now displayed in the project list. [#5209](https://github.com/scalableminds/webknossos/pull/5209)
- Added the possibility to export binary data as tiff (if long-runnings jobs are enabled). [#5195](https://github.com/scalableminds/webknossos/pull/5195)
- Added a link to dataset view mode from annotation mode info tab. [#5262](https://github.com/scalableminds/webknossos/pull/5262)
- Added the possibility to export also volume annotations as tiff (if long-runnings jobs are enabled). [#5246](https://github.com/scalableminds/webknossos/pull/5246)
- WKW Dataset uploads with missing mag or layer dir no longer fail, instead the paths are automatically added (defaults to color/1). [#5285](https://github.com/scalableminds/webknossos/pull/5285)

### Changed
- Measured distances will be shown in voxel space, too. [#5240](https://github.com/scalableminds/webknossos/pull/5240)
- Improved documentation and inline-help for data import and conversion. [#5420](https://github.com/scalableminds/webknossos/pull/5420)

### Fixed
- Fixed a regression in the task search which could lead to a frontend crash. [#5267](https://github.com/scalableminds/webknossos/pull/5267)
- Fixed a rendering bug in oblique mode. [#5289](https://github.com/scalableminds/webknossos/pull/5289)
- Fixed a bug where uploading NMLs from dashboard via file picker was inaccessible. [#5308](https://github.com/scalableminds/webknossos/pull/5308)

### Breaking Change
- The front-end API methods `measurePathLengthBetweenNodes`, `measureAllTrees` and `measureTreeLength` were changed to return a tuple containing the distance in nm and in vx (instead of only returning the distance in nm). [#5240](https://github.com/scalableminds/webknossos/pull/5240)

## [21.03.0](https://github.com/scalableminds/webknossos/releases/tag/21.03.1) - 2021-02-24
[Commits](https://github.com/scalableminds/webknossos/compare/21.03.0...21.03.1)

### Highlights
- The "Meshes" tab was overhauled, so that it displays generated isosurfaces and imported meshes. Generated isosurfaces can be jumped to, reloaded, downloaded and removed. [#4917](https://github.com/scalableminds/webknossos/pull/4917)
- Before uploading a dataset webKnossos automatically checks whether a conversion and scale are needed. Additionally, the Upload UI was improved. [#5081](https://github.com/scalableminds/webknossos/issues/5081)
- Support for KNOSSOS cubes data format was removed. Use the [webKnossos cuber](https://github.com/scalableminds/webknossos-cuber) tool to convert existing datasets saved as KNOSSOS cubes. [#5085](https://github.com/scalableminds/webknossos/pull/5085)

### Added
- Added an explicit `/signup` (or `/auth/signup`) route. [#5091](https://github.com/scalableminds/webknossos/pull/5091)
- Added the annotation option "center new nodes" to switch whether newly created nodes should be centered or not. [#4150](https://github.com/scalableminds/webknossos/pull/5112)
- For webKnossos maintenance, superUsers can now join organizations without being listed as a user there. [#5151](https://github.com/scalableminds/webknossos/pull/5151)
- Added the possibility to track events for analytics in the backend. [#5156](https://github.com/scalableminds/webknossos/pull/5156)

### Changed
- Changed the font to [Titillium Web](http://nta.accademiadiurbino.it/titillium/). [#5161](https://github.com/scalableminds/webknossos/pull/5161)
- Made the isosurface feature in the meshes tab more robust. If a request fails, a retry is initiated. [#5102](https://github.com/scalableminds/webknossos/pull/5102)
- Support for the old invite links was removed. These contained the organization name in the URL. The new links contain a token (can be generated in the users view). For instances with a single organization the old invite links should still work. [#5091](https://github.com/scalableminds/webknossos/pull/5091)
- Users are no longer allowed to deactivate their own accounts.  [#5070](https://github.com/scalableminds/webknossos/pull/5070)
- Users are asked to confirm when leaving the dataset upload view while an upload is still running. [#5051](https://github.com/scalableminds/webknossos/pull/5049)
- Mailer now uses only TLS1.2 instead of JDK default. [#5138](https://github.com/scalableminds/webknossos/pull/5138)
- Make keyboard-driven movement through the dataset better aligned with the configured move value in certain scenarios. [#5201](https://github.com/scalableminds/webknossos/pull/5201)
- User experience domains are now separated by organization. [#5149](https://github.com/scalableminds/webknossos/pull/5149)
- Changed the default request timeouts for standalone datastores and tracingstores to match those of local ones (10000s instead of 75s). [#5174](https://github.com/scalableminds/webknossos/pull/5174)

### Fixed
- Fixed a bug where the user could delete teams that were still referenced in annotations, projects or task types, thus creating invalid state. [#5108](https://github.com/scalableminds/webknossos/pull/5108)
- Fixed a bug where an error occurred when clicking on the hours/week graph in the statistics overview page. [#4779](https://github.com/scalableminds/webknossos/pull/5113)
- Fixed a bug where the listing of users that have open tasks of a project failed. [#5115](https://github.com/scalableminds/webknossos/pull/5115)
- Fixed a bug that task scripts weren't correctly re-initialized when a new task was requested. This happened when certain conditions were met. [#5199](https://github.com/scalableminds/webknossos/issues/5199)
- Fixed some scenarios where the Meshes tab could cause errors (e.g., when the UI was used but no segmentation layer was available). [#5142](https://github.com/scalableminds/webknossos/pull/5142)
- Fixed a bug where the user (and telemetry) would get a cryptic error message when trying to register with an email that is already in use. [#5152](https://github.com/scalableminds/webknossos/pull/5152)
- Fixed a bug where default dataset configuration could not be loaded if a dataset was accessed via sharing token [#5164](https://github.com/scalableminds/webknossos/pull/5164)
- Fixed a bug where viewing a volume task as compound annotation failed for tasks with single instances. [#5198](https://github.com/scalableminds/webknossos/pull/5198)

### Removed
- The isosurface setting was removed. Instead, isosurfaces can be generated via the "Meshes" tab. Also note that the Shift+Click binding for generating an isosurface was removed (for now). Please refer to the "Meshes" tab, too. [#4917](https://github.com/scalableminds/webknossos/pull/4917)

## [21.02.1](https://github.com/scalableminds/webknossos/releases/tag/21.02.1) - 2021-02-03
[Commits](https://github.com/scalableminds/webknossos/compare/21.02.0...21.02.1)

### Fixed
- Fixed a bug where the listing of users that have open tasks of a project failed. [#5115](https://github.com/scalableminds/webknossos/pull/5115)
- Fixed shift+clicking isosurfaces in annotations which contain skeletons. [#5257](https://github.com/scalableminds/webknossos/pull/5257)

## [21.02.0](https://github.com/scalableminds/webknossos/releases/tag/21.02.0) - 2021-01-20
[Commits](https://github.com/scalableminds/webknossos/compare/21.01.0...21.02.0)

### Highlights
- The dataset import UI was streamlined by making it clearer when automatic suggestions are available for the dataset properties. Previously, these suggestions were applied automatically which could cause some confusion. [#4944](https://github.com/scalableminds/webknossos/pull/4944)
- Added the possibility to generate skeletons from an HDF5 agglomerate file mapping on-the-fly. With an activated agglomerate file mapping, use `Shift + Middle Mouse Click` to import a skeleton of the cell into the annotation. Alternatively, use the button in the segmentation tab to import a skeleton of the centered cell into the annotation. [#4958](https://github.com/scalableminds/webknossos/pull/4958)

### Added
- Added a context menu via *Shift & Right Click* that provides easy access to skeleton functionalities and additional information. [#4950](https://github.com/scalableminds/webknossos/pull/4950)
- Added a cleanup procedure for erroneous uploads, so failed uploads can be retried without changing the dataset name. [#4999](https://github.com/scalableminds/webknossos/pull/4999)

### Changed
- Suggestions for the datasource settings of a dataset are no longer applied automatically. They can be applied optionally now. [#4944](https://github.com/scalableminds/webknossos/pull/4944)
- The brush tool is disabled in low magnifications (magnification 16 and lower) to avoid performance problems when annotating. [#5017](https://github.com/scalableminds/webknossos/pull/5017)
- The fill tool is disabled in low magnifications (magnification 2 and lower) to avoid producing spotty annotations (caused by needing too much main memory). [#5050](https://github.com/scalableminds/webknossos/pull/5050)
- Users can now join multiple organizations, admins can now invite users by email address, skipping the manual user activation step. [#4984](https://github.com/scalableminds/webknossos/pull/4984)
- Dataset Manager role now additionally grants permission to create explorative annotations on all datasets. [#5037](https://github.com/scalableminds/webknossos/pull/5037)

### Fixed
- Fixed a bug where importing NMLs failed if they had unescaped greater-than signs inside of attributes. [#5003](https://github.com/scalableminds/webknossos/pull/5003)
- Mitigate errors concerning localStorage quotas in the datasets dashboard. [#5039](https://github.com/scalableminds/webknossos/pull/5039)
- Fixed a bug where viewing a dataset via sharingToken crashed. [#5047](https://github.com/scalableminds/webknossos/pull/5047)

## [21.01.0](https://github.com/scalableminds/webknossos/releases/tag/21.01.0) - 2020-12-21
[Commits](https://github.com/scalableminds/webknossos/compare/20.12.0...21.01.0)

### Highlights
- The menu for viewing, editing and creating annotations for a dataset in the dashboard was cleaned up a bit. Creating a hybrid (skeleton + volume) annotation is now the default way of annotating a dataset. The other options are still available via a dropdown. [#4939](https://github.com/scalableminds/webknossos/pull/4939)

### Added
- Datasets without any layer are now considered unimported. [#4959](https://github.com/scalableminds/webknossos/pull/4959)

### Changed
- For 2d-only datasets the view mode toggle is hidden. [#4952](https://github.com/scalableminds/webknossos/pull/4952)
- Persist the selected overwrite behavior for hybrid and volume annotations. [#4962](https://github.com/scalableminds/webknossos/pull/4962)
- Backend NML parser now allows NML nodes without radius attribute. Instead, their radius now defaults to a value of 1.0, which is also the new default value for initial nodes. Note that the node radius is only relevant when default setting “overwrite node radius” is disabled. [#4982](https://github.com/scalableminds/webknossos/pull/4982)

### Fixed
- Fix crash for trees with high comment count (> 100000 nodes). [#4965](https://github.com/scalableminds/webknossos/pull/4965)
- Fix the upload of single file datasets. [#4977](https://github.com/scalableminds/webknossos/pull/4977)

## [20.12.0](https://github.com/scalableminds/webknossos/releases/tag/20.12.0) - 2020-11-23
[Commits](https://github.com/scalableminds/webknossos/compare/20.11.0...20.12.0)

### Highlights
- Added multi-resolution volume annotations. As a result, volume tracings can be viewed even when zooming out to downsampled magnifications. Note that already existing volume tracings will still only contain data in the first magnification. If you want to migrate an old volume tracing, you can explicitly trigger the downsampling in the sidebar's layer settings. [#4755](https://github.com/scalableminds/webknossos/pull/4755)
- Improved performance of volume annotations (brush and trace tool). [#4848](https://github.com/scalableminds/webknossos/pull/4848)

### Added
- The total length of skeletons can now be measured using the dropdown in the tree list tab. Also, the frontend API received the methods `api.tracing.measureTreeLength` and `api.tracing.measureAllTrees`. [#4898](https://github.com/scalableminds/webknossos/pull/4898)
- Introduced an indeterminate visibility state for groups in the tree tab if not all but only some of the group's children are visible. Before, the visibility of those groups was shown as not visible which made it hard to find the visible trees. [#4897](https://github.com/scalableminds/webknossos/pull/4897)
- Dataset uploads on a specific Datastore can now be restricted to a single organization. [#4892](https://github.com/scalableminds/webknossos/pull/4892)
- Added a button to set the color of a tree in the trees tab view. [#4907](https://github.com/scalableminds/webknossos/pull/4907)

### Changed
- In the tree tab, all groups but the root group are now collapsed instead of expanded when opening a tracing. [#4897](https://github.com/scalableminds/webknossos/pull/4897)
- New volume/hybrid annotations are now automatically multi-resolution volume annotations. [#4755](https://github.com/scalableminds/webknossos/pull/4755)
- Re-enabled continuous brush strokes. This feature ensures that even fast brush strokes are continuous and don't have "holes". [#4924](https://github.com/scalableminds/webknossos/pull/4924)
- The Histogram now has a correct linear scale. [#4926](https://github.com/scalableminds/webknossos/pull/4926)

### Fixed
- Fixed the disappearing of dataset settings after switching between view mode and annotation mode. [#4845](https://github.com/scalableminds/webknossos/pull/4845)
- Fixed a rare error in the agglomerate mapping for large datasets. [#4904](https://github.com/scalableminds/webknossos/pull/4904)
- Fixed a bug where in volume annotation zip upload some buckets were discarded. [#4914](https://github.com/scalableminds/webknossos/pull/4914)
- Fixed the Dataset import which was broken temporarily. [#4932](https://github.com/scalableminds/webknossos/pull/4932)
- Fixed the upload of multiple volume annotations with similar data zip names. [#4915](https://github.com/scalableminds/webknossos/pull/4915)

## [20.11.0](https://github.com/scalableminds/webknossos/releases/tag/20.11.0) - 2020-10-26
[Commits](https://github.com/scalableminds/webknossos/compare/20.10.0...20.11.0)

### Highlights
- Improved the toolbar to make the different webKnossos tools easier to use. For example, the fill-tool and the cell-picker have a dedicated button in volume annotations now. [#4875](https://github.com/scalableminds/webknossos/pull/4875)
- The dataset upload is now more robust and can recover from a failed upload of a data chunk. [#4860](https://github.com/scalableminds/webknossos/pull/4860)
- Movements in the 3D viewport are now time-tracked. [#4876](https://github.com/scalableminds/webknossos/pull/4876)

### Added
- Hybrid tracings can now be imported directly in the tracing view via drag'n'drop. [#4837](https://github.com/scalableminds/webknossos/pull/4837)
- The find data function now works for volume tracings, too. [#4847](https://github.com/scalableminds/webknossos/pull/4847)
- Added admins and dataset managers to dataset access list, as they can access all datasets of the organization. [#4862](https://github.com/scalableminds/webknossos/pull/4862)
- Added the possibility to move the current position by dragging with the middle-mouse-button (regardless of the active tool). [#4875](https://github.com/scalableminds/webknossos/pull/4875)
- Sped up the NML parsing via dashboard import. [#4872](https://github.com/scalableminds/webknossos/pull/4872)

### Changed
- Brush circles are now connected with rectangles to provide a continuous stroke even if the brush is moved quickly. [#4785](https://github.com/scalableminds/webknossos/pull/4822)
- The position input of tracings now accepts decimal input. When losing focus the values are cut off at the comma. [#4803](https://github.com/scalableminds/webknossos/pull/4803)
- webknossos.org only: Accounts associated with new organizations can now be created even when a datastore is unreachable. The necessary folders are created lazily when needed. [#4846](https://github.com/scalableminds/webknossos/pull/4846)
- When downloading a volume tracing, buckets containing a single 0 byte, that were created to restore older versions, are now skipped. [#4851](https://github.com/scalableminds/webknossos/pull/4851)
- Task information CSV now contains additional column `creationInfo`, containing the original NML filename for tasks based on existing NMLs. [#4866](https://github.com/scalableminds/webknossos/pull/4866)
- The default overwrite-behavior in volume annotating changed so that erasing with the brush- or trace-tool always erases all voxels (regardless of their segment id). Before that, only the current segment id was overwritten by default. As before, this behavior can be toggled by pressing CTRL. Alternatively, one can now also switch the mode in the toolbar. [#4875](https://github.com/scalableminds/webknossos/pull/4875)

### Fixed
- Fixed failing histogram requests for float layers with NaN values. [#4834](https://github.com/scalableminds/webknossos/pull/4834)

## [20.10.0](https://github.com/scalableminds/webknossos/releases/tag/20.10.0) - 2020-9-21
[Commits](https://github.com/scalableminds/webknossos/compare/20.09.0...20.10.0)

### Highlights
- Added the possibility to undo and redo volume annotation strokes. [#4771](https://github.com/scalableminds/webknossos/pull/4771)
- Isosurface generation now also supports volume tracings (without fallback layers). [#4567](https://github.com/scalableminds/webknossos/pull/4567)
- Added a tool to initiate a flood fill in a volume tracing with the active cell id. [#4780](https://github.com/scalableminds/webknossos/pull/4780)
- Added the possibility to navigate to the preceding/subsequent node by pressing "ctrl + ," or "ctrl + ." in a skeleton tracing. [#4147](https://github.com/scalableminds/webknossos/pull/4784)

### Added
- Added the possibility to merge volume tracings both via file upload (zip of zips) and when viewing projects/tasks as compound annotations. [#4709](https://github.com/scalableminds/webknossos/pull/4709)
- Added the possibility to remove the fallback segmentation layer from a hybrid/volume tracing. Accessible by a minus button next to the layer's settings. [#4741](https://github.com/scalableminds/webknossos/pull/4766)

### Changed
- When d/f switching is turned off and a slice is copied with the shortcut `v`, the previous slice used as the source will always be slice - 1 and `shift + v` will always take slice + 1 as the slice to copy from. [#4728](https://github.com/scalableminds/webknossos/pull/4728)
- Disabled the autofill feature of the brush when using this tool to erase data. [#4729](https://github.com/scalableminds/webknossos/pull/4729)
- The rotation buttons of the 3D-viewport no longer change the zoom. [#4750](https://github.com/scalableminds/webknossos/pull/4750)
- Improved the performance of applying agglomerate files. [#4706](https://github.com/scalableminds/webknossos/pull/4706)
- When uploading tasks via NML, NML are shown in the task modal instead of a toast. [#4723](https://github.com/scalableminds/webknossos/pull/4723)

### Fixed
- Improved the data loading behavior for flight and oblique mode. [#4800](https://github.com/scalableminds/webknossos/pull/4800)
- Fixed an issue where in some cases the tree list was only visible after the window was resized. [#4816](https://github.com/scalableminds/webknossos/pull/4816)
- Fixed a bug where some volume annotations that had been reverted to a previous version became un-downloadable. [#4805](https://github.com/scalableminds/webknossos/pull/4805)
- Fixed a UI bug where some tooltip wouldn't close after editing a label. [#4815](https://github.com/scalableminds/webknossos/pull/4815)

## [20.09.0](https://github.com/scalableminds/webknossos/releases/tag/20.9.0) - 2020-8-20
[Commits](https://github.com/scalableminds/webknossos/compare/20.8.0...20.09.0)

### Highlights
- Improved the distinguishability of segments by improving the color generation and also by rendering patterns within the segments. The pattern opacity can be adapted in the layer settings (next to the opacity of the segmentation layer). [#4730](https://github.com/scalableminds/webknossos/pull/4730)
- Added the possibility to move nodes in skeleton tracings. This can be done either by pressing CTRL + arrow key or by dragging while holding CTRL. [#4743](https://github.com/scalableminds/webknossos/pull/4743)

### Added
- Added the possibility to delete datasets on disk from webKnossos. Use with care. [#4696](https://github.com/scalableminds/webknossos/pull/4696)
- Added error toasts for failing bucket requests. [#4740](https://github.com/scalableminds/webknossos/pull/4740)
- Added a list of all projects containing tasks of a specific task type. It's accessible from the task types list view. [#4420](https://github.com/scalableminds/webknossos/pull/4745)

### Changed
- When d/f switching is turned off and a slice is copied with the shortcut `v`, the previous slice used as the source will always be slice - 1 and `shift + v` will always take slice + 1 as the slice to copy from. [#4728](https://github.com/scalableminds/webknossos/pull/4728)
- Disabled the autofill feature of the brush when using this tool to erase data. [#4729](https://github.com/scalableminds/webknossos/pull/4729)
- The rotation buttons of the 3D-viewport no longer change the zoom. [#4750](https://github.com/scalableminds/webknossos/pull/4750)
- Improved the performance of applying agglomerate files. [#4706](https://github.com/scalableminds/webknossos/pull/4706)
- In the Edit/Import Dataset form, the "Sharing" tab was renamed to "Sharing & Permissions". Also, existing permission-related settings were moved to that tab.  [#4683](https://github.com/scalableminds/webknossos/pull/4763)
- Improved rotation of camera in 3D viewport. [#4768](https://github.com/scalableminds/webknossos/pull/4768)
- Improved handling and communication of failures during download of data from datasets. [#4765](https://github.com/scalableminds/webknossos/pull/4765)
- The volume annotation tools in hybrid tracings are disabled while in merger mode. [#4757](https://github.com/scalableminds/webknossos/pull/4770)
- The title of a tab now shows the active tracing or dataset as well as the corresponding organization. [#4653](https://github.com/scalableminds/webknossos/pull/4767)
- When viewing or tracing a dataset with only one slice (2D data) the default layout displays only the XY plane. The other viewports can still be accessed by changing the viewport tab. [#4738](https://github.com/scalableminds/webknossos/pull/4778)

### Fixed
- Speed up NML import in existing tracings for NMLs with many trees (20,000+). [#4742](https://github.com/scalableminds/webknossos/pull/4742)
- Fixed tree groups when uploading NMLs with multi-component trees. [#4735](https://github.com/scalableminds/webknossos/pull/4735)
- Fixed that invalid number values in slider settings could crash webKnossos. [#4758](https://github.com/scalableminds/webknossos/pull/4758)
- Improved resilience in time tracking, preventing overlapping timespans. [#4830](https://github.com/scalableminds/webknossos/pull/4830)

## [20.08.0](https://github.com/scalableminds/webknossos/releases/tag/20.08.0) - 2020-07-20
[Commits](https://github.com/scalableminds/webknossos/compare/20.07.0...20.08.0)

### Highlights
- Added the possibility to have multiple user-defined bounding boxes in an annotation. Task bounding boxes are automatically converted to such user bounding boxes upon “copy to my account” / reupload as explorational annotation. [#4536](https://github.com/scalableminds/webknossos/pull/4536)
- Separated the permissions of Team Managers (now actually team-scoped) and Dataset Managers (who can see all datasets). The database evolution makes all Team Managers also Dataset Managers, so no workflows should be interrupted. New users may have to be made Dataset Managers, though. For more information, refer to the updated documentation. [#4663](https://github.com/scalableminds/webknossos/pull/4663)
- Backend NML parser no longer rejects NMLs with trees that have multiple connected components. Instead, it splits those into one separate tree per component. [#4688](https://github.com/scalableminds/webknossos/pull/4688)

### Added

- Added the possibility to adjust the minimum and maximum value of the histogram for a layer. This option can be opened in the top right corner of the histogram. [#4630](https://github.com/scalableminds/webknossos/pull/4630)
- Added a warning to the segmentation tab when viewing `uint64` bit segmentation data. [#4598](https://github.com/scalableminds/webknossos/pull/4598)
- Added the possibility to have multiple user-defined bounding boxes in an annotation. Task bounding boxes are automatically converted to such user bounding boxes upon “copy to my account” / reupload as explorational annotation. [#4536](https://github.com/scalableminds/webknossos/pull/4536)
- Added additional information to each task in CSV download. [#4647](https://github.com/scalableminds/webknossos/pull/4647)
- Added the possibility to configure the sender address used in emails wk sends (mail.defaultSender in application.conf). [#4701](https://github.com/scalableminds/webknossos/pull/4701)
- Added a warning during task creation if task dataset cannot be accessed by project team members. [#4695](https://github.com/scalableminds/webknossos/pull/4695)
- Included the server time in error messages, making debugging misbehavior easier. [#4707](https://github.com/scalableminds/webknossos/pull/4707)

### Changed
- Separated the permissions of Team Managers (now actually team-scoped) and Dataset Managers (who can see all datasets). The database evolution makes all Team Managers also Dataset Managers, so no workflows should be interrupted. New users may have to be made Dataset Managers, though. For more information, refer to the updated documentation. [#4663](https://github.com/scalableminds/webknossos/pull/4663)
- Refined all webKnossos emails for user signups etc. Switched emails to use HTML templates for more bling bling. [#4676](https://github.com/scalableminds/webknossos/pull/4676)
- Backend NML parser no longer rejects NMLs with trees that have multiple connected components. Instead, it splits those into one separate tree per component. [#4688](https://github.com/scalableminds/webknossos/pull/4688)

### Fixed
- Fixed that merger mode didn't work with undo and redo. Also fixed that the mapping was not disabled when disabling merger mode. [#4669](https://github.com/scalableminds/webknossos/pull/4669)
- Fixed a bug where webKnossos relied upon but did not enforce organization names to be unique. [#4685](https://github.com/scalableminds/webknossos/pull/4685)
- Fixed that being outside of a bounding box could be rendered as if one was inside the bounding box in some cases. [#4690](https://github.com/scalableminds/webknossos/pull/4690)
- Fixed a bug where admins could revoke their own admin rights even if they are the only admin in their organization, leading to an invalid state. [#4698](https://github.com/scalableminds/webknossos/pull/4698)
- Fixed a bug where webKnossos ignored existing layer category information from datasource-properties.json when exploring layers on disk. [#4694](https://github.com/scalableminds/webknossos/pull/4694)

### Removed

- Removed the “are you sure” warning when editing datasets with no allowed teams. Instead, a warning during task creation is shown in this case. [#4695](https://github.com/scalableminds/webknossos/pull/4695)



## [20.07.0](https://github.com/scalableminds/webknossos/releases/tag/20.07.0) - 2020-06-29
[Commits](https://github.com/scalableminds/webknossos/compare/20.06.0...20.07.0)

### Highlights

- Fixed that the dataset list in the dashboard could reorder its items asynchronously which could be very annoying for the user. [#4640](https://github.com/scalableminds/webknossos/pull/4640)

### Added

- Added a warning to the segmentation tab when viewing `uint64` bit segmentation data. [#4598](https://github.com/scalableminds/webknossos/pull/4598)

### Changed

- The redundant “team” column was removed from the bulk task creation format. [#4629](https://github.com/scalableminds/webknossos/pull/4629)
- The brush size minimum was changed from 5 voxels to 1. [#4648](https://github.com/scalableminds/webknossos/pull/4648)

### Fixed

- Fixed that the dataset list in the dashboard could reorder its items asynchronously which could be very annoying for the user. [#4640](https://github.com/scalableminds/webknossos/pull/4640)
- Improved resilience when refreshing datasets while a datastore is down. [#4636](https://github.com/scalableminds/webknossos/pull/4636)
- Fixed a bug where requesting volume tracing fallback layer data from webknossos-connect failed. [#4644](https://github.com/scalableminds/webknossos/pull/4644)
- Fixed a bug where imported invisible trees were still visible. [#4659](https://github.com/scalableminds/webknossos/issues/4659)
- Fixed the message formatting for standalone datastores and tracingstores. [#4656](https://github.com/scalableminds/webknossos/pull/4656)

## [20.06.0](https://github.com/scalableminds/webknossos/releases/tag/20.06.0) - 2020-05-25
[Commits](https://github.com/scalableminds/webknossos/compare/20.05.0...20.06.0)

### Highlights
- Compression of volume tracing data is now already done in the browser, reducing I/O load and required disk space. [#4602](https://github.com/scalableminds/webknossos/pull/4602) and [#4623](https://github.com/scalableminds/webknossos/pull/4623)

### Added

- Added the possibility to select hour, minute and second of the time range in the timetracking view. [#4604](https://github.com/scalableminds/webknossos/pull/4604)
- Volume tracing data is now saved with lz4 compression, reducing I/O load and required disk space. [#4602](https://github.com/scalableminds/webknossos/pull/4602)
- Volume tracing data is now already lz4-compressed in the browser, further reducing server load. [#4623](https://github.com/scalableminds/webknossos/pull/4623)

### Changed
- Improved the UI in navigation bar during loading of tracings and datasets. [#4612](https://github.com/scalableminds/webknossos/pull/4612)
- Improved logging in case of very slow annotation saving. Additionally, the user is also warned when there are unsaved changes older than two minutes. [#4593](https://github.com/scalableminds/webknossos/pull/4593)
- REST API for creating / changing datastores now contains additional field `allowsUpload` denoting if the datastore allows uploading datasets via browser. [#4614](https://github.com/scalableminds/webknossos/pull/4614)

### Fixed

- When activating an agglomerate file-based ID mapping, only the segmentation layer will be reloaded from now on. This will improve mapping activation performance. [#4600](https://github.com/scalableminds/webknossos/pull/4600)
- Fixed retrying of failed save requests sent during tracingstore restart. [#4591](https://github.com/scalableminds/webknossos/pull/4591)
- Fixed the initial loading of agglomerate mappings, where some buckets remained black. [#4601](https://github.com/scalableminds/webknossos/pull/4601)
- Fixed occasional error during loading of compound annotations (such as viewing multiple finished task instances in one view). [#4619](https://github.com/scalableminds/webknossos/pull/4619)

## [20.05.0](https://github.com/scalableminds/webknossos/releases/tag/20.05.0) - 2020-05-05
[Commits](https://github.com/scalableminds/webknossos/compare/20.04.0...20.05.0)

### Highlights
- Added support for ID mapping of segmentation layer based on HDF5 agglomerate files. [#4469](https://github.com/scalableminds/webknossos/pull/4469)
- Added option to hide all unmapped segments to segmentation tab. [#4510](https://github.com/scalableminds/webknossos/pull/4510)
- It is now possible to upload volume tracings as a base for tasks. The upload format is similar to the project / task type download format. [#4565](https://github.com/scalableminds/webknossos/pull/4565)
- Added the possibility to share the dataset which is currently viewed (using a private token if the dataset is not public).  The option can be found in the dropdown of the navigation bar. [#4543](https://github.com/scalableminds/webknossos/pull/4543)

### Added
- Users can undo finishing a task when the task was finished via the API, e.g. by a user script. [#4495](https://github.com/scalableminds/webknossos/pull/4495)
- Added the magnification used for determining the segment ids in the segmentation tab to the table of the tab. [#4480](https://github.com/scalableminds/webknossos/pull/4480)
- Added support for ID mapping of segmentation layer based on HDF5 agglomerate files. [#4469](https://github.com/scalableminds/webknossos/pull/4469)
- Added the possibility to share the dataset which is currently viewed (using a private token if the dataset is not public).  The option can be found in the dropdown of the navigation bar. [#4543](https://github.com/scalableminds/webknossos/pull/4543)
- Added option to hide all unmapped segments to segmentation tab. [#4510](https://github.com/scalableminds/webknossos/pull/4510)
- When wK changes datasource-properties.json files of datasets, now it creates a backup log of previous versions. [#4534](https://github.com/scalableminds/webknossos/pull/4534)
- Added a warning to the position input in tracings if the current position is out of bounds. The warning colors the position input orange. [#4544](https://github.com/scalableminds/webknossos/pull/4544)
- Isosurface generation now also supports hdf5-style mappings. [#4531](https://github.com/scalableminds/webknossos/pull/4531)

### Changed
- Reported datasets can now overwrite existing ones that are reported as missing, this ignores the isScratch precedence. [#4465](https://github.com/scalableminds/webknossos/pull/4465)
- Improved the performance for large skeleton tracings with lots of comments. [#4473](https://github.com/scalableminds/webknossos/pull/4473)
- Users can now input floating point numbers into the rotation field in flight and oblique mode. These values will get rounded internally. [#4507](https://github.com/scalableminds/webknossos/pull/4507)
- Deleting an empty tree group in the `Trees` tab no longer prompts for user confirmation. [#4506](https://github.com/scalableminds/webknossos/pull/4506)
- Toggling the "Render missing data black" option now automatically reloads all layers making it unnecessary to reload the whole page. [#4516](https://github.com/scalableminds/webknossos/pull/4516)
- The "mappings" attribute of segmentation layers in datasource jsons can now be omitted. [#4532](https://github.com/scalableminds/webknossos/pull/4532)
- Uploading a single nml, allows to wrap the tracing in a new tree group. [#4563](https://github.com/scalableminds/webknossos/pull/4563)
- Unconnected trees no longer cause an error during NML import in the tracing view. Instead, unconnected trees are split into their components. The split components are wrapped in a tree group with the original tree's name. [#4541](https://github.com/scalableminds/webknossos/pull/4541)
- Made the NML importer in the tracing view less strict. Incorrect timestamps, missing tree names or missing node radii no longer cause an error. [#4541](https://github.com/scalableminds/webknossos/pull/4541)
- Disabled the backend-side apply agglomerate feature for downsampled magnifications (still allowed for 1 to 8) to save server capacity. [#4578](https://github.com/scalableminds/webknossos/pull/4578)
- REST API endpoints finish and info now expect additional GET parameter `timestamp=[INT]` timestamp in milliseconds (time the request is sent). [#4580](https://github.com/scalableminds/webknossos/pull/4580)
- It is now possible to upload volume tracings as a base for tasks. The upload format is similar to the project / task type download format. [#4565](https://github.com/scalableminds/webknossos/pull/4565)

### Fixed
- Users only get tasks of datasets that they can access. [#4488](https://github.com/scalableminds/webknossos/pull/4488)
- Ignoring an error message caused by the drag and drop functionality. This error claims that a reload of the tracing is required although everything is fine. [#4544](https://github.com/scalableminds/webknossos/pull/4544)
- Fixed that after selecting a node in the 3d viewport the rotating center of the viewport was not updated immediately. [#4544](https://github.com/scalableminds/webknossos/pull/4544)
- Fixed the import of datasets which was temporarily broken. [#4497](https://github.com/scalableminds/webknossos/pull/4497)
- Fixed the displayed segment ids in segmentation tab when "Render Missing Data Black" is turned off. [#4480](https://github.com/scalableminds/webknossos/pull/4480)
- The datastore checks if a organization folder can be created before creating a new organization. [#4501](https://github.com/scalableminds/webknossos/pull/4501)
- Fixed a bug where under certain circumstances groups in the tree tab were not sorted by name. [#4542](https://github.com/scalableminds/webknossos/pull/4542)
- Fixed that `segmentationOpacity` could not be set anymore as part of the recommended settings for a task type. [#4545](https://github.com/scalableminds/webknossos/pull/4545)
- Fixed registration for setups with one organization and not configured defaultOrganization. [#4559](https://github.com/scalableminds/webknossos/pull/4559)
- Fixed a rendering error which could make some layers disappear in certain circumstances. [#4556](https://github.com/scalableminds/webknossos/pull/4556)
- Fixed a rendering error which caused negative float data to be rendered white. [#4556](https://github.com/scalableminds/webknossos/pull/4571)
- Fixed the histogram creation if some sampled positions don't contain data. [#4584](https://github.com/scalableminds/webknossos/pull/4584)
- Fixed a rendering exception which could occur in rare circumstances. [#4588](https://github.com/scalableminds/webknossos/pull/4588)

## [20.04.0](https://github.com/scalableminds/webknossos/releases/tag/20.04.0) - 2020-03-23
[Commits](https://github.com/scalableminds/webknossos/compare/20.03.0...20.04.0)

### Highlights
- Added the possibility to reopen finished tasks as non-admin for a configurable time. [#4415](https://github.com/scalableminds/webknossos/pull/4415)
- Added support for drag-and-drop import of NML files even if the current view is read-only (e.g., because a dataset was opened in "view" mode). In this case, a new tracing is directly created into which the NML file is imported. [#4459](https://github.com/scalableminds/webknossos/pull/4459)
- Added support for setting view configuration defaults in the `datasource-properties.json`. Use the `defaultViewConfiguration` field for Dataset settings and the `defaultViewConfiguration` field inside a layer for layer-specific settings. [#4357](https://github.com/scalableminds/webknossos/pull/4357)


### Added
- Added support for setting view configuration defaults in the `datasource-properties.json`. Use the `defaultViewConfiguration` field for Dataset settings and the `defaultViewConfiguration` field inside a layer for layer-specific settings. [#4357](https://github.com/scalableminds/webknossos/pull/4357)
- Added a notification when downloading nml including volume that informs that the fallback data is excluded in the download. [#4413](https://github.com/scalableminds/webknossos/pull/4413)
- Added the possibility to reopen finished tasks as non-admin for a configurable time. [#4415](https://github.com/scalableminds/webknossos/pull/4415)
- Added support for drag-and-drop import of NML files even if the current view is read-only (e.g., because a dataset was opened in "view" mode). In this case, a new tracing is directly created into which the NML file is imported. [#4459](https://github.com/scalableminds/webknossos/pull/4459)
- Added download of task configurations as CSV after task creation and in the task list view. [#4491](https://github.com/scalableminds/webknossos/pull/4491)
- Added indication for reloading a dataset in the dataset actions in the dashboard. [#4421](https://github.com/scalableminds/webknossos/pull/4421)
- Added support for creating a tree group when importing a single NML into an existing annotation. [#4489](https://github.com/scalableminds/webknossos/pull/4489)
- Added login prompt to the tracing page when fetching the dataset fails. Upon successful login, the dataset gets fetched with the rights of the newly logged-in user. [#4467](https://github.com/scalableminds/webknossos/pull/4467)

### Changed
- Changed NML import in tracings to try parsing files as NMLs and protobuf regardless of the file extension. [#4421](https://github.com/scalableminds/webknossos/pull/4421)
- Using the "Best Quality First" strategy in combination with having the "Render Black Data" setting disabled works better now. [#4470](https://github.com/scalableminds/webknossos/pull/4470)
- Default interval for detecting new/deleted datasets on disk has been reduced from 10 to 1 minute. [#4464](https://github.com/scalableminds/webknossos/pull/4464)
- The config values datastore.publicUri, tracingstore.publicUri and http.uri are now reapplied from the config at every startup if your instance has localhost-stores [#4482](https://github.com/scalableminds/webknossos/pull/4482)

### Fixed
- Fixed that a node was created when using right click while brushing mode is active in hybrid tracings. [#4433](https://github.com/scalableminds/webknossos/pull/4433)
- Fixed opening view only dataset links with arbitrary modes being initially displayed in plane mode. [#4421](https://github.com/scalableminds/webknossos/pull/4421)
- Fixed that converting a volume tracing into a hybrid tracing opens the hybrid tracing in "volume" mode. [#4467](https://github.com/scalableminds/webknossos/pull/4467)
- Fixed a bug where users were wrongly allowed to edit the description of an annotation they were allowed to see but not update [#4466](https://github.com/scalableminds/webknossos/pull/4466)
- Fixed the creation of histograms for float datasets that only have one value besides 0. [#4468](https://github.com/scalableminds/webknossos/pull/4468)
- Fixed the creation of histograms for float datasets that have values close to the minimum. [#4475](https://github.com/scalableminds/webknossos/pull/4475)
- Fixed the import of datasets which was temporarily broken. [#4497](https://github.com/scalableminds/webknossos/pull/4497)

### Removed
-

## [20.03.0](https://github.com/scalableminds/webknossos/releases/tag/20.03.0) - 2020-02-27
[Commits](https://github.com/scalableminds/webknossos/compare/20.02.0...20.03.0)

### Highlights
- Added support for datasets with more layers than the hardware can render simultaneously. The user can disable layers temporarily to control for which layers the GPU resources should be used. [#4424](https://github.com/scalableminds/webknossos/pull/4424)
- Time tracking precision is improved. [#4445](https://github.com/scalableminds/webknossos/pull/4445)

### Added
- Added support for datasets with more layers than the hardware can render simultaneously. The user can disable layers temporarily to control for which layers the GPU resources should be used. [#4424](https://github.com/scalableminds/webknossos/pull/4424)
- Added a notification when downloading nml including volume that informs that the fallback data is excluded in the download. [#4413](https://github.com/scalableminds/webknossos/pull/4413)
- Added a simpler method to install webKnossos on an own server. [#4446](https://github.com/scalableminds/webknossos/pull/4446)

### Changed
- Made the navbar scrollable on small screens. [#4413](https://github.com/scalableminds/webknossos/pull/4413)
- Opening the settings sidebar when viewing a dataset or tracing defaults to the dataset settings now. [#4425](https://github.com/scalableminds/webknossos/pull/4425)
- Better onboarding experience for new users on webknossos.org. [#4439](https://github.com/scalableminds/webknossos/pull/4439)

### Fixed
- Fixed that for uint16 data layer the default value range of [0, 255] was used, causing most of the data to look white without manual adjustments. Now the correct range of [0, 65535] is used as default. [#4381](https://github.com/scalableminds/webknossos/pull/4381)
- Time tracking precision is improved. [#4445](https://github.com/scalableminds/webknossos/pull/4445)

### Removed
-


## [20.02.0](https://github.com/scalableminds/webknossos/releases/tag/20.02.0) - 2020-01-27
[Commits](https://github.com/scalableminds/webknossos/compare/20.01.0...20.02.0)

### Added
- Added new viewing permission for annotations: public (everyone with the link has access, logged in or not), internal (everyone from your organization has access), private (only you and your team managers and admins have access). The new default is internal as it is the old default non-public.
- Added support for using task ids as base for a new task, if the corresponding task only has one (finished) instance. [#4404](https://github.com/scalableminds/webknossos/pull/4404)

### Changed
- Changed the error message when importing a dataset without resolution directories. [#4389](https://github.com/scalableminds/webknossos/pull/4389)

### Fixed
- Fixed the deactivation of datasets if no datasets are present. [#4388](https://github.com/scalableminds/webknossos/pull/4388)
- Fixed the team sharing settings for private annotations. [#4409](https://github.com/scalableminds/webknossos/pull/4409)
- Fixed the team sharing loading for read only tracings. [#4411](https://github.com/scalableminds/webknossos/pull/4411)
- Fixed the renaming of annotations in the tracing view. [#4416](https://github.com/scalableminds/webknossos/pull/4416)


## [20.01.0](https://github.com/scalableminds/webknossos/releases/tag/20.01.0) - 2020-01-08
[Commits](https://github.com/scalableminds/webknossos/compare/19.12.0...20.01.0)

### Highlights
- Added a scale to the y-axis of histograms to indicate the logarithmic representation. Additionally, small histogram values are smoothed out. [#4349](https://github.com/scalableminds/webknossos/pull/4349)
- You can now share your annotations with selected teams. These annotations appear in the Shared Annotations Tab in the dashboard. [#4304](https://github.com/scalableminds/webknossos/pull/4304)

### Added
- Added `publicUri` configs for datastore and tracingstore for initial setup. [#4368](https://github.com/scalableminds/webknossos/pull/4368)
- Added a button to delete all cached data buckets of color layer and the reload them. [#4383](https://github.com/scalableminds/webknossos/pull/4383)
- Added a scale to the y-axis of histograms to indicate the logarithmic representation. Additionally, small histogram values are smoothed out. [#4349](https://github.com/scalableminds/webknossos/pull/4349)
- Added a new way of sharing annotations. You can share your annotations with selected teams. These annotations appear in the Shared Annotations Tab in the dashboard. [#4304](https://github.com/scalableminds/webknossos/pull/4304)
- Added an option to invert the color values of color layers. [#4382](https://github.com/scalableminds/webknossos/pull/4382)

### Changed
- Changed the way the new active tree is selected after deleting a tree. Now the tree with the next highest id, compared to the id of the deleted tree, is selected. [#4370](https://github.com/scalableminds/webknossos/pull/4370)
- Consolidates URI handling in the config. Pairs of `uri` and `secured` entries are now specified as just `uri` and require either `http://` or `https://` prefix. [#4368](https://github.com/scalableminds/webknossos/pull/4368)
- Renamed initial organization for the dev deployment to `sample_organization`. [#4368](https://github.com/scalableminds/webknossos/pull/4368)

### Fixed
- Fixed an issue where webKnossos would complain in certain scenarios when resolutions of datasets were not complete. [#4344](https://github.com/scalableminds/webknossos/pull/4344)
- Fixed permissions to all task lists, so only administrable tasks can get accessed. [#4331](https://github.com/scalableminds/webknossos/pull/4331)


## [19.12.0](https://github.com/scalableminds/webknossos/releases/tag/19.12.0) - 2019-11-25
[Commits](https://github.com/scalableminds/webknossos/compare/19.11.0...19.12.0)

### Highlights
- Added possibility to disable saving in an explorative annotation. This feature can save a lot of resources when dealing with very large NMLs which don't need to be persisted. [#4321](https://github.com/scalableminds/webknossos/pull/4321)
- Added support for importing tracings in a binary protobuf format via drag and drop. [#4320](https://github.com/scalableminds/webknossos/pull/4320)
- Fixed broken sorting in the dataset table of the dashboard. [#4318](https://github.com/scalableminds/webknossos/pull/4318)

### Added
- Added support for importing tracings in a binary protobuf format via drag and drop. [#4320](https://github.com/scalableminds/webknossos/pull/4320)
- Added an API to set a tree active by name. [#4317](https://github.com/scalableminds/webknossos/pull/4317)
- Added possibility to disable saving in an explorative annotation. This feature can save a lot of resources when dealing with very large NMLs which don't need to be persisted. [#4321](https://github.com/scalableminds/webknossos/pull/4321)

### Changed
- Some user actions, like deleting a group with all subtrees, resulted in lots of entries in the undo stack (one for each deleted tree). Those actions are now handled as a single atomic change and can be undone with a single undo invocation. [#4312](https://github.com/scalableminds/webknossos/pull/4312)
- The "Find Data" feature will jump to the center of the layer's bounding box, if no data could be found. The "Find Data" feature can be found next to each layer's name in the dataset settings tab. [#4346](https://github.com/scalableminds/webknossos/pull/4346)

### Fixed
- Fixed broken sorting in the dataset table of the dashboard. [#4318](https://github.com/scalableminds/webknossos/pull/4318)
- Fixed annotation access to match the text in the modal. [#4314](https://github.com/scalableminds/webknossos/pull/4314)
- Fixed that the brush tool could be selected in an read-only tracing. [#4345](https://github.com/scalableminds/webknossos/pull/4345)
- Fixed the name of downloaded annotation zips. [#4330](https://github.com/scalableminds/webknossos/pull/4330)

## [19.11.0](https://github.com/scalableminds/webknossos/releases/tag/19.11.0) - 2019-10-28
[Commits](https://github.com/scalableminds/webknossos/compare/19.10.0...19.11.0)

### Added
- Added an API to manage DataStores and TracingStores as admin. [#4286](https://github.com/scalableminds/webknossos/pull/4286)

### Fixed
- Cleaned up error reporting wording in case of dataset access failures (e.g. due to not being logged in). [#4301](https://github.com/scalableminds/webknossos/pull/4301)
- Fixed handling of uint64 data layers in sql evolution. [#4303](https://github.com/scalableminds/webknossos/pull/4303)


## [19.10.0](https://github.com/scalableminds/webknossos/releases/tag/19.10.0) - 2019-09-30
[Commits](https://github.com/scalableminds/webknossos/compare/19.09.0...19.10.0)

### Highlights
- Clicking on an experience domain of a user, while multiple users are selected will edit the domain of all selected users (instead of only the domain of the clicked row). [#4280](https://github.com/scalableminds/webknossos/pull/4280)
- Creating a new skeleton tree group will always activate that group. [#4282](https://github.com/scalableminds/webknossos/pull/4282)
- Resetting a task to the initials state is now also allowed for volume tasks. [#4276](https://github.com/scalableminds/webknossos/pull/4276)

### Added
- Reset to base is now also allowed for volume tasks. [#4276](https://github.com/scalableminds/webknossos/pull/4276)

### Changed

- Renamed "Expected Time" to "Time Limit" in the project table. [#4278](https://github.com/scalableminds/webknossos/pull/4278)
- Clicking on an experience domain of a user, while multiple users are selected will edit the domain of all selected users (instead of only the domain of the clicked row). [#4280](https://github.com/scalableminds/webknossos/pull/4280)
- Creating a new skeleton tree group will always activate that group. [#4282](https://github.com/scalableminds/webknossos/pull/4282)

### Fixed
- When creating tasks from zip, the individual nml names are used again, rather than the zip name. [#4277](https://github.com/scalableminds/webknossos/pull/4277)

### Removed
- Removed the Search shortcut (Ctrl+Shift+F) for comments in the tracing view, since that shortcut collides with the tree search. [#4291](https://github.com/scalableminds/webknossos/pull/4291)

## [19.09.0](https://github.com/scalableminds/webknossos/releases/tag/19.09.0) - 2019-08-28
[Commits](https://github.com/scalableminds/webknossos/compare/19.08.0...19.09.0)

### Highlights
- Users can see their own time statistics now. [#4220](https://github.com/scalableminds/webknossos/pull/4220)
- Added limited support for `uint64` segmentation layer by using the lower 4 bytes. [#4233](https://github.com/scalableminds/webknossos/pull/4233)
- Added a scale bar to the 3D viewport. [#4258](https://github.com/scalableminds/webknossos/pull/4258)
- Added currently spent hours on a project to the project progress view. [#4236](https://github.com/scalableminds/webknossos/pull/4236)


### Added
- Added the possibility to have an existing annotation as a base for a new task, thus making it also possible to have a base tracing for volume tasks. [#4198](https://github.com/scalableminds/webknossos/pull/4198)
- Indicating active nml downloads with a loading icon. [#4228](https://github.com/scalableminds/webknossos/pull/4228)
- Added possibility for users to see their own time statistics. [#4220](https://github.com/scalableminds/webknossos/pull/4220)
- Added merger mode as a setting for task types. Enabling this setting will automatically activate merger mode in tasks. [#4269](https://github.com/scalableminds/webknossos/pull/4269)
- The segmentation layer can now be turned invisible and also supports the find data feature. [#4232](https://github.com/scalableminds/webknossos/pull/4232)
- Enabled the advanced search for the comment tab. [#4238](https://github.com/scalableminds/webknossos/pull/4238)
- Added limited support for `uint64` segmentation layer by using the lower 4 bytes. [#4233](https://github.com/scalableminds/webknossos/pull/4233)
- Added an API route to add and delete dataStores. [#4242](https://github.com/scalableminds/webknossos/pull/4242)
- Added a scale bar to the 3D viewport. [#4258](https://github.com/scalableminds/webknossos/pull/4258)
- Added the possibility to import an nml file as a string and to reset the active skeleton tracing to the API. [#4252](https://github.com/scalableminds/webknossos/pull/4252)
- Added currently spent hours on a project to the project progress view. [#4236](https://github.com/scalableminds/webknossos/pull/4236)

### Changed
- Each of the  columns of the dataset table and explorative annotations table in the dashboard now have an individual fixed width, so the tables become scrollable on smaller screens. [#4207](https://github.com/scalableminds/webknossos/pull/4207)
- When uploading a zipped annotation (such as volume / hybrid / collection), the zip name is used for the resulting explorative annotation, rather than the name of the contained NML file. [#4222](https://github.com/scalableminds/webknossos/pull/4222)
- Color and segmentation layer are not longer treated separately in the dataset settings in tracing/view mode.  [#4232](https://github.com/scalableminds/webknossos/pull/4232)

### Fixed
- Data for disabled or invisible layers will no longer be downloaded, saving bandwidth and speeding up webKnossos in general. [#4202](https://github.com/scalableminds/webknossos/pull/4202)
- Fixed tooltip not disappearing in the statistics view in certain circumstances. [#4219](https://github.com/scalableminds/webknossos/pull/4219)
- Fixed the error messages when trying to access a dataset with insufficient permissions. [#4244](https://github.com/scalableminds/webknossos/pull/4244)
- Fixed the upload of volume tracings by recognizing the correct format of the fallback layer. [#4248](https://github.com/scalableminds/webknossos/pull/4248)
- Fixed an imprecision when exporting an NML via the front-end. [#4262](https://github.com/scalableminds/webknossos/pull/4262)
- Fixed viewing and tracing of datasets which only contain a segmentation layer. [#4265](https://github.com/scalableminds/webknossos/pull/4265)


## [19.08.0](https://github.com/scalableminds/webknossos/releases/tag/19.08.0) - 2019-07-29
[Commits](https://github.com/scalableminds/webknossos/compare/19.07.0...19.08.0)

### Highlights
- Added the possibility to remove isosurfaces from the 3D viewport by CTRL+Clicking it. [#4185](https://github.com/scalableminds/webknossos/pull/4185)
- Added support for int16 and uint16 color layers. [#4152](https://github.com/scalableminds/webknossos/pull/4152)
- Team managers and admins can now get tasks that they had previously cancelled. [#4088](https://github.com/scalableminds/webknossos/pull/4088)
- Increased performance for time logging. [#4196](https://github.com/scalableminds/webknossos/pull/4196)

### Added
- Volume tasks with only one finished instance can now be viewed as CompoundTask. [#4167](https://github.com/scalableminds/webknossos/pull/4167)
- Added the possibility to remove isosurfaces from the 3D viewport by CTRL+Clicking it. [#4185](https://github.com/scalableminds/webknossos/pull/4185)
- Added support for `int16` and `uint16` color layers. [#4152](https://github.com/scalableminds/webknossos/pull/4152)
- Added histogram support for `int16` and `uint16` color layers. Additionally refined support for `float` color layers. [#4195](https://github.com/scalableminds/webknossos/pull/4195)

### Changed
- Volume project download zips are reorganized to contain a zipfile for each annotation (that in turn contains a data.zip and an nml file). [#4167](https://github.com/scalableminds/webknossos/pull/4167)
- Team managers and admins can now get tasks that they had previously cancelled. [#4088](https://github.com/scalableminds/webknossos/pull/4088)
- Recording is now automatically turned off when switching from flight/oblique to orthogonal mode to prevent accidental node creation when switching back later. [#4211](https://github.com/scalableminds/webknossos/pull/4211)

### Fixed
- Fixed a bug where volume tracings could not be converted to hybrid. [#4159](https://github.com/scalableminds/webknossos/pull/4159)
- Fixed a bug where for uint24 color layers, scrambled data was shown for missing magnifications. [#4188](https://github.com/scalableminds/webknossos/pull/4188)
- Fixed a bug where collapsing/expanding all tree groups would trigger when toggling a single tree [#4178](https://github.com/scalableminds/webknossos/pull/4178)
- Fixed performance for time logging. [#4196](https://github.com/scalableminds/webknossos/pull/4196)
- Personal tracing layouts are saved per user now. [#4217](https://github.com/scalableminds/webknossos/pull/4217)
- Fixed an error message when quickly resizing the browser window. [#4205](https://github.com/scalableminds/webknossos/pull/4205)

### Removed
-


## [19.07.0](https://github.com/scalableminds/webknossos/releases/tag/19.07.0) - 2019-07-01
[Commits](https://github.com/scalableminds/webknossos/compare/19.06.0...19.07.0)

### Highlights
- Added a histogram and min- / max-sliders to the dataset settings for each layer. This replaces the brightness and contrast settings. [#4105](https://github.com/scalableminds/webknossos/pull/4105)
- Added the possibility to enforce a certain magnification range for tasks (can be configured in the corresponding task type). [#4101](https://github.com/scalableminds/webknossos/pull/4101)
- Added the possibility for admins to add experience domains while creating new tasks. [#4119](https://github.com/scalableminds/webknossos/pull/4119)

### Added
- Added the possibility to enforce a certain magnification range for tasks (can be configured in the corresponding task type). [#4101](https://github.com/scalableminds/webknossos/pull/4101)
- Added the possibility for admins to add experience domains while creating new tasks. [#4119](https://github.com/scalableminds/webknossos/pull/4119)
- Added a histogram to the dataset settings for each layer. It simplifies adjusting the brightness and contrast of a layer and replaces the brightness and contrast slider. [#4105](https://github.com/scalableminds/webknossos/pull/4105)
- The dataset and the explorative annotations table in the dashboard are now horizontally scrollable if the window is not wide enough. Additionally, clicking on the name of a dataset in the dataset table opens the dataset in view mode. [#4136](https://github.com/scalableminds/webknossos/pull/4136)
- Added an two additional buttons to the dropdown menu of the tree hierarchy view. On Click, one collapses the other expands all subgroups. [#4143](https://github.com/scalableminds/webknossos/pull/4143)
### Changed
- The tooltip of the timeline chart in the Time Tracking view now displays the duration in minutes:seconds. [#4121](https://github.com/scalableminds/webknossos/pull/4121)
- Reactivated and renamed the "Quality" setting to "Hardware Utilization". Using a higher value will render data in higher quality, but puts more stress on the user's hardware and bandwidth. [#4142](https://github.com/scalableminds/webknossos/pull/4142)


### Fixed
- Fixed that team managers couldn't view time tracking details of other users anymore. [#4125](https://github.com/scalableminds/webknossos/pull/4125)
- Fixed the positioning of the tooltip of the timeline chart in the Time Tracking view. [#4121](https://github.com/scalableminds/webknossos/pull/4121)
- Fixed a rendering problem which caused a red viewport on some Windows machines. [#4133](https://github.com/scalableminds/webknossos/pull/4133)

### Removed
- The brightness and contrast slider in the dataset got removed in favour of the new histogram feature. [#4105](https://github.com/scalableminds/webknossos/pull/4105)


## [19.06.0](https://github.com/scalableminds/webknossos/releases/tag/19.06.0) - 2019-05-27
[Commits](https://github.com/scalableminds/webknossos/compare/19.05.0...19.06.0)

### Highlights
- The time tracking view now displays dates instead of hours when having more than one day selected. [#4028](https://github.com/scalableminds/webknossos/pull/4028)
- BossDB datasets can now be added to webKnossos using the webknossos-connect service. [#4036](https://github.com/scalableminds/webknossos/pull/4036)
- When holding CTRL while toggling the visibility of a layer, that layer will be made exclusively visible. [#4061](https://github.com/scalableminds/webknossos/pull/4061)

### Added
- Non-admin users now can see their own tracing time statistics. [#4028](https://github.com/scalableminds/webknossos/pull/4028)
- The extent of a dataset is now displayed next to the scale in the dataset list in the dashboard. [#4058](https://github.com/scalableminds/webknossos/pull/4058)
- BossDB datasets can now be added to webKnossos using the webknossos-connect service. [#4036](https://github.com/scalableminds/webknossos/pull/4036)
- Added an auto-brush feature for selected datasets. [#4053](https://github.com/scalableminds/webknossos/pull/4053)
- When holding CTRL while toggling the visibility of a layer, that layer will be made exclusively visible. This change makes it easier to quickly compare different data layers against each other. [#4061](https://github.com/scalableminds/webknossos/pull/4061)

### Changed
- Heavily improved mapping creation/activation performance. [#4103](https://github.com/scalableminds/webknossos/pull/4103)
- The NML parser now rounds floating point values in node coordinates. [#4045](https://github.com/scalableminds/webknossos/pull/4045)
- The time tracking view now displays dates instead of hours when having more then one day selected. The display id's in the timeline diagram are not the task ids. The tooltip of the timeline diagram also got a rework. [#4028](https://github.com/scalableminds/webknossos/pull/4028)
- Improved the editing of datasets. Changes suggested by webKnossos will be easier to recognize as suggestions. [4104](https://github.com/scalableminds/webknossos/pull/4104)
- The time tracking view now displays dates instead of hours when having more than one day selected. The display id's in the timeline diagram are not the task ids. The tooltip of the timeline diagram also got a rework. [#4028](https://github.com/scalableminds/webknossos/pull/4028)

### Fixed
- Fixed an issue where the 3D view was not rendered correctly after maximizing another pane. [#4098](https://github.com/scalableminds/webknossos/pull/4098)
- The admin task list now only shows tasks belonging to a project one can administrate. [#4087](https://github.com/scalableminds/webknossos/pull/4087)
- When making a hybrid tracing from a volume tracing, the user bounding box is no longer lost. [#4062](https://github.com/scalableminds/webknossos/pull/4062)

### Removed
- It is no longer possible to scroll through planes while dragging one. [#4085](https://github.com/scalableminds/webknossos/pull/4085)


## [19.05.0](https://github.com/scalableminds/webknossos/releases/tag/19.05.0) - 2019-04-29
[Commits](https://github.com/scalableminds/webknossos/compare/19.04.0...19.05.0)

### Changed
- Improved performance for large tracings. [#3995](https://github.com/scalableminds/webknossos/pull/3995)
- Improved how the rendering quality can be adapted in the settings. The setting can now be used to tune the quality to your hardware specification. [#4015](https://github.com/scalableminds/webknossos/pull/4015)
- Empty trees in skeleton tracings are now allowed. [#4010](https://github.com/scalableminds/webknossos/pull/4010)
- Creating a hybrid tracing now asks whether to use the existing segmentation layer or use a new one. [#4033](https://github.com/scalableminds/webknossos/pull/4033)

### Fixed
- Fixed a missing redirect after registering for an existing organization (with autoVerify=true) via the onboarding flow. [#3984](https://github.com/scalableminds/webknossos/pull/3984)
- Fixed rendering artifacts which could occur under certain conditions. [#4015](https://github.com/scalableminds/webknossos/pull/4015)
- Fixed that the zoom step was reset after switching to a new task. [#4049](https://github.com/scalableminds/webknossos/pull/4049)


## [19.04.0](https://github.com/scalableminds/webknossos/releases/tag/19.04.0) - 2019-04-01
[Commits](https://github.com/scalableminds/webknossos/compare/19.03.0...19.04.0)

### Highlights
This release multiple new interactions are expanding webKnossos:
- Added merger mode for skeleton and hybrid tracings. It allows to merge segments from e.g. generated oversegmentations. [#3619](https://github.com/scalableminds/webknossos/pull/3619)
- Added a shortcut (Q) and button to screenshot the tracing views. [#3834](https://github.com/scalableminds/webknossos/pull/3834)
- Rendered isosurfaces in the 3D viewport can now be interacted with. Shift+Click on an isosurface will jump exactly to where you clicked. Also, hovering over an isosurface will highlight that cell in all viewports. [#3858](https://github.com/scalableminds/webknossos/pull/3858)
- Neuroglancer precomputed datasets can now be added to webKnossos using the webknossos-connect service. [#3843](https://github.com/scalableminds/webknossos/pull/3843)

Also the data viewing and tracing workflow is smoothed further:
- Different loading strategies are now supported ("best quality first" and "progressive quality"). Additionally, the rendering can use different magnifications as a fallback. [#3801](https://github.com/scalableminds/webknossos/pull/3801)
- Performance improvements :racing_car: [#3880](https://github.com/scalableminds/webknossos/pull/3880) & [#3902](https://github.com/scalableminds/webknossos/pull/3902)

### Added
- Rendered isosurfaces in the 3D viewport can now be interacted with. Shift+Click on an isosurface will jump exactly to where you clicked. Also, hovering over an isosurface will highlight that cell in all viewports. [#3858](https://github.com/scalableminds/webknossos/pull/3858)
- webKnossos now comes with a list of sample datasets that can be automatically downloaded and imported from the menu. [#3725](https://github.com/scalableminds/webknossos/pull/3725)
- Added a shortcut (Q) and button in the actions dropdown to screenshot the tracing views. The screenshots will contain everything that is visible in the tracing views, so feel free to disable the crosshairs in the settings or toggle the tree visibility using the (1) and (2) shortcuts before triggering the screenshot. [#3834](https://github.com/scalableminds/webknossos/pull/3834)
- Neuroglancer precomputed datasets can now be added to webKnossos using the webknossos-connect (wk-connect) service. To setup a wk-connect datastore follow the instructions in the [Readme](https://github.com/scalableminds/webknossos-connect). Afterwards, datasets can be added through "Add Dataset" - "Add Dataset via wk-connect". [#3843](https://github.com/scalableminds/webknossos/pull/3843)
- Added support for mappings for 8-bit and 16-bit segmentation layers. [#3953](https://github.com/scalableminds/webknossos/pull/3953)
- The dataset settings within the tracing view allow to select between different loading strategies now ("best quality first" and "progressive quality"). Additionally, the rendering can use different magnifications as a fallback (instead of only one magnification). [#3801](https://github.com/scalableminds/webknossos/pull/3801)
- The mapping selection dropdown is now sorted alphabetically. [#3864](https://github.com/scalableminds/webknossos/pull/3864)
- Added the possibility to filter datasets in the dashboard according to their availability. By default, datasets which are missing on disk (e.g., when the datastore was deleted) are not shown anymore. This behavior can be configured via the settings icon next to the search box in the dashboard. [#3883](https://github.com/scalableminds/webknossos/pull/3883)
- Added merger mode for skeleton and hybrid tracings. It allows to merge segments from e.g. generated segmentations. [#3619](https://github.com/scalableminds/webknossos/pull/3619)
- The HTML template now includes SEO tags for demo instances and hides internal instances from search engines.
- Segmentation ID mappings can now be used in volume and hybrid tracings. [#3949](https://github.com/scalableminds/webknossos/pull/3949)
- A maximize-button was added to the viewports in the annotation view. Maximization can also be toggled with the `.` shortcut. [#3876](https://github.com/scalableminds/webknossos/pull/3876)
- [webknossos-connect](https://github.com/scalableminds/webknossos-connect) now starts with webKnossos on local and development instances by default. [#3913](https://github.com/scalableminds/webknossos/pull/3913)
- The visibilities of trees in a skeleton tracing is now persisted across page loads. [#3942](https://github.com/scalableminds/webknossos/pull/3942)
- Added a button for each color layer to enable/disable the layer. [#3943](https://github.com/scalableminds/webknossos/pull/3943)
- Paginated routes now send a `X-Total-Count` HTTP header which shows how many entries were found in total. [#3899](https://github.com/scalableminds/webknossos/pull/3899)

### Changed
- Improved the flight mode performance for tracings with very large trees (>80.000 nodes). [#3880](https://github.com/scalableminds/webknossos/pull/3880)
- Tweaked the highlighting of the active node. The inner node looks exactly as a non-active node and is not round, anymore. An active node is circled by a "halo". In arbitrary mode, the halo is hidden and the active node is round. [#3868](https://github.com/scalableminds/webknossos/pull/3868)
- Improved the performance of moving through a dataset which should make the overall interaction smoother. [#3902](https://github.com/scalableminds/webknossos/pull/3902)
- Brush size is independent of zoom value, now. This change simplifies volume annotations, as brush sizes can be adapted to certain structures (e.g., vesicles) and don't need to be changed when zooming. [#3868](https://github.com/scalableminds/webknossos/pull/3889)
- Reworked the search in the trees tab. [#3878](https://github.com/scalableminds/webknossos/pull/3878)

### Fixed
- Fixed a bug where failed large save requests lead to inconsistent tracings on the server. [#3829](https://github.com/scalableminds/webknossos/pull/3829)
- Fixed the setting which enables to hide the planes within the 3D viewport. [#3857](https://github.com/scalableminds/webknossos/pull/3857)
- Fixed a bug which allowed the brush size to become negative when using shortcuts. [#3861](https://github.com/scalableminds/webknossos/pull/3861)
- Fixed interpolation along z-axis. [#3888](https://github.com/scalableminds/webknossos/pull/3888)
- Fixed that the halo of the active node could cover other nodes. [#3919](https://github.com/scalableminds/webknossos/pull/3919)
- Fixed that the 3D viewport was partially occluded due to clipping distance issues. [#3919](https://github.com/scalableminds/webknossos/pull/3919)
- Fixed that scrolling with the mouse wheel over a data viewport also scrolled the page. This bug appeared with the new Chrome version 73. [#3939](https://github.com/scalableminds/webknossos/pull/3939)

### Removed
- Removed FPS meter in Annotation View. [#3916](https://github.com/scalableminds/webknossos/pull/3916)


## [19.03.0](https://github.com/scalableminds/webknossos/releases/tag/19.03.0) - 2019-03-04
[Commits](https://github.com/scalableminds/webknossos/compare/19.02.0...19.03.0)

### Highlights
- The tracing view got two major improvements:
   - Data rendering is now fully using the available space and doesn't have to be quadratic anymore. Increasing the size of a viewport will result in more data being rendered (as opposed to the same data will be upscaled). [#3634](https://github.com/scalableminds/webknossos/pull/3634)
   - The active node is highlighted with a "halo ring". Additionally, the node is also rendered as a circle. In flight and oblique modes the halo is hidden. [#3731](https://github.com/scalableminds/webknossos/pull/3731)
- Added the possibility to create volume annotation tasks. When creating a task type, select whether to create `volume` or `skeleton` tasks. Compound viewing and file upload for volume tasks is not yet supported. [#3712](https://github.com/scalableminds/webknossos/pull/3712)
- Mappings for segmentations will be read automatically from the file system. It's not necessary to define the mappings within the `datasource-properties.json` anymore. [#3720](https://github.com/scalableminds/webknossos/pull/3720)

### Added
- Added the possibility to create volume annotation tasks. When creating a task type, select whether to create `volume` or `skeleton` tasks. Note that compound viewing for volume tasks is not supported yet. Same for creating volume tasks from uploaded nml/data files. [#3712](https://github.com/scalableminds/webknossos/pull/3712)
- Added an UI to select a mapping for a segmentation layer. The UI is placed in the segmentation tab within the tracing view. [#3720](https://github.com/scalableminds/webknossos/pull/3720)
- Added a button to jump to actual data if the bounding box of a dataset contains a lot of black data. [#3682](https://github.com/scalableminds/webknossos/pull/3682)

### Changed
- Data rendering is not tied to square viewports, anymore. As a result the screen space is used more efficiently to show data. Also, increasing the size of a viewport will result in more data being rendered (as opposed to the same data will be upscaled). [#3634](https://github.com/scalableminds/webknossos/pull/3634)
- Mappings for segmentations will be read automatically from the file system. It's not necessary to define the mappings within the `datasource-properties.json`, anymore. [#3720](https://github.com/scalableminds/webknossos/pull/3720)
- The active node is highlighted with a "halo ring". Additionally, the node is also rendered as a circle. In flight and oblique modes the halo is hidden. [#3731](https://github.com/scalableminds/webknossos/pull/3731)
- In the dashboard list of active tasks, the project name is now featured more prominently, as it switched places with the task type summary. [#3792](https://github.com/scalableminds/webknossos/pull/3792)
- Isosurfaces are now loaded from the middle outwards. [#3818](https://github.com/scalableminds/webknossos/pull/3818)
- The brush size will now be remembered across page reloads. [#3827](https://github.com/scalableminds/webknossos/pull/3827)
- Do not show publication view if no publications are specified. [#3778](https://github.com/scalableminds/webknossos/pull/3778)

### Fixed
- Fixed an error that occurred when changing the URL hash. [#3746](https://github.com/scalableminds/webknossos/pull/3746)
- Fixed a bug in the timeline chart rendering. The start and end time of the timeline chart now match the selected time range. [#3772](https://github.com/scalableminds/webknossos/pull/3772)
- The modals for a new task description and recommended task settings are no longer shown in read-only tracings. [#3724](https://github.com/scalableminds/webknossos/pull/3724)
- Fixed a rendering bug when opening a task that only allowed flight/oblique mode tracing. [#3783](https://github.com/scalableminds/webknossos/pull/3783)
- Fixed a bug where some NMLs caused the webKnossos tab to freeze during NML upload. [#3758](https://github.com/scalableminds/webknossos/pull/3758)
- Fixed a bug where some skeleton save requests were wrongly rejected if they were sent more than once. [#3767](https://github.com/scalableminds/webknossos/pull/3767)
- Fixed a bug which caused a wrong aspect ratio in the 3D viewport when changing the layout. [#3817](https://github.com/scalableminds/webknossos/pull/3817)


## [19.02.0](https://github.com/scalableminds/webknossos/releases/tag/19.02.0) - 2019-02-04
[Commits](https://github.com/scalableminds/webknossos/compare/19.01.0...19.02.0)

### Highlights

- The Dataset Gallery was redesigned to be a Publication Gallery instead. It will feature scientific publications together with their published datasets and information such as the species, brain region or acquisition method of such datasets. [#3653](https://github.com/scalableminds/webknossos/pull/3653)
  Please see the [migration guide](MIGRATIONS.released.md#19020---2019-02-04) on how to add publications.
- Also, this release includes new features that enrich the view of your data:
   - Isosurface computation can now be triggered for whole segments (shift + click on a segment in view mode). [#3655](https://github.com/scalableminds/webknossos/pull/3655)
   - Added the possibility to fade the alpha value of data layers. Also, a dataset can now contain both RGB and grayscale layers. [#3670](https://github.com/scalableminds/webknossos/pull/3670)
- The volume annotation brush tool will now automatically fill any enclosed areas if the brushed outline is closed in one stroke. [#3698](https://github.com/scalableminds/webknossos/pull/3698)
  <img src="https://user-images.githubusercontent.com/1702075/51846983-02d34480-231b-11e9-86f2-2d8c4b0c9bd0.gif" width="200" />


### Added

- Added the possibility to fade the alpha value of data layers. Also, a dataset can now contain both RGB and grayscale layers. [#3670](https://github.com/scalableminds/webknossos/pull/3670)
- Added the possibility to disable that the current layout is saved automatically when changing it. Instead, the layout can be saved explicitly. [#3620](https://github.com/scalableminds/webknossos/pull/3620)
- Added the possibility to use flight and oblique mode when viewing a dataset. [#3644](https://github.com/scalableminds/webknossos/pull/3644)
- Added pagination to the REST API route `GET /projects/:name/tasks` (new optional parameters `limit` and `pageNumber`). [#3659](https://github.com/scalableminds/webknossos/pull/3659)
- Added the possibility to open the version restore view for read-only tracings. Older versions can be previewed and be downloaded as NML. [#3660](https://github.com/scalableminds/webknossos/pull/3660)

### Changed

- Team managers are now also allowed to create and own scripts. [#3676](https://github.com/scalableminds/webknossos/pull/3676)
- The Dataset Gallery was redesigned to be a Publication Gallery instead. It will feature scientific publications together with their published datasets and information such as the species, brain region or acquisition method of such datasets. [#3653](https://github.com/scalableminds/webknossos/pull/3653)
- Annotations for non-public datasets can now be shared using the "Share" functionality without making the dataset public. [#3664](https://github.com/scalableminds/webknossos/pull/3664)
- The volume annotation brush tool will now automatically fill any enclosed areas if the brushed outline is closed in one stroke. [#3698](https://github.com/scalableminds/webknossos/pull/3698)
  <img src="https://user-images.githubusercontent.com/1702075/51846983-02d34480-231b-11e9-86f2-2d8c4b0c9bd0.gif" width="200" />
- Statistics are now separated by organization, rather than showing the webKnossos instance’s totals. [#3663](https://github.com/scalableminds/webknossos/pull/3663)
- NML files can be imported into arbitrary datasets. Users will be asked to confirm the import process if the dataset of the NML differs from the currently active dataset. [#3716](https://github.com/scalableminds/webknossos/pull/3716)

### Fixed

- Fixed a rendering bug which caused data to be clipped in certain scenarios for datasets with anisotropic resolutions. [#3609](https://github.com/scalableminds/webknossos/pull/3609)
- Fixed a bug where saving tracings failed after they were open for >24h. [#3633](https://github.com/scalableminds/webknossos/pull/3633)
- Fixed a bug that resulted in slow data loading when moving quickly through a dataset. [#3656](https://github.com/scalableminds/webknossos/pull/3656)
- Fixed a bug which caused the wrong magnification to be rendered when zooming out very far. [#3641](https://github.com/scalableminds/webknossos/pull/3641)
- Fixed a bug which broke the functionality to toggle the visibility of a tree in a skeleton tracing. [#3719](https://github.com/scalableminds/webknossos/pull/3719)

## [19.01.0](https://github.com/scalableminds/webknossos/releases/tag/19.01.0) - 2019-01-14
[Commits](https://github.com/scalableminds/webknossos/compare/18.12.0...19.01.0)

### Highlights

- You can now create tracings on datasets of other organizations, provided you have access rights to the dataset (i.e. it is public). [#3533](https://github.com/scalableminds/webknossos/pull/3533)
- Added the experimental feature to dynamically render isosurfaces for segmentation layers (can be enabled in the dataset settings when viewing a dataset). [#3495](https://github.com/scalableminds/webknossos/pull/3495)
- Added the possibility to specify a recommended user configuration in a task type. The recommended configuration will be shown to users when they trace a task with a different task type and the configuration can be accepted or declined. [#3466](https://github.com/scalableminds/webknossos/pull/3466)
- Added the possibility to select multiple trees in skeleton tracings in the tree tab by using ctrl + left mouse. Deleting and moving trees will affect all selected trees. [#3457](https://github.com/scalableminds/webknossos/pull/3457)

### Added

- Added the possibility to select multiple trees in skeleton tracings in the tree tab by using ctrl + left mouse. Deleting and moving trees will affect all selected trees. [#3457](https://github.com/scalableminds/webknossos/pull/3457)
- Added the possibility to specify a recommended user configuration in a task type. The recommended configuration will be shown to users when they trace a task with a different task type and the configuration can be accepted or declined. [#3466](https://github.com/scalableminds/webknossos/pull/3466)
- You can now create tracings on datasets of other organizations, provided you have access rights to the dataset (i.e. it is public). [#3533](https://github.com/scalableminds/webknossos/pull/3533)
- Datasets imported through a datastore that is marked as 'scratch' will now show a construction-like header and error message to encourage moving the datasets to a permanent storage location. [#3500](https://github.com/scalableminds/webknossos/pull/3500)
- Added the experimental feature to dynamically render isosurfaces for segmentation layers (can be enabled in the dataset settings when viewing a dataset). [#3495](https://github.com/scalableminds/webknossos/pull/3495)
- Adds healthchecks to all Dockerfiles for automatic service healing [#3606](https://github.com/scalableminds/webknossos/pull/3606)
- Added possibility to load more tasks or explorative annotations in the dashboard. [#3505](https://github.com/scalableminds/webknossos/pull/3505)
- Adds a second colorful thumbnail for the datasets which have a segmentation layer and this segmentation thumbnail will be shown on hover over the other thumbnail. [#3507](https://github.com/scalableminds/webknossos/pull/3507)

### Fixed

- Fixed a performance issue for large tracings with many branch points. [#3519](https://github.com/scalableminds/webknossos/pull/3519)
- Fixed bug which caused buckets to disappear randomly. [#3531](https://github.com/scalableminds/webknossos/pull/3531)
- Fixed a bug which broke the redirect after dataset upload via GUI. [#3571](https://github.com/scalableminds/webknossos/pull/3571)

## [18.12.0](https://github.com/scalableminds/webknossos/releases/tag/18.12.0) - 2018-11-26
[Commits](https://github.com/scalableminds/webknossos/compare/18.11.0...18.12.0)

### Highlights

- Added the possibility to add STL mesh files to tracings. [#3367](https://github.com/scalableminds/webknossos/pull/3367)
- Improved support for datasets with a large skew in scale. [#3398](https://github.com/scalableminds/webknossos/pull/3398)
- Improved performance for flight mode. [#3392](https://github.com/scalableminds/webknossos/pull/3392)
- Fixed the guessed bounding box for datasets that do not start at (0,0,0). [#3437](https://github.com/scalableminds/webknossos/pull/3437)

### Added

- Added the possibility to add STL mesh files to tracings. [#3367](https://github.com/scalableminds/webknossos/pull/3367)

### Changed

- Improved support for datasets with a large skew in scale (e.g., [600, 600, 35]). [#3398](https://github.com/scalableminds/webknossos/pull/3398)
- Improved performance for flight mode. [#3392](https://github.com/scalableminds/webknossos/pull/3392)

### Fixed

- Fixed a bug where the initial onboarding setup failed if automatic initial data was disabled. [#3421](https://github.com/scalableminds/webknossos/pull/3421)
- Fixed a permission issue in the try setup.
- Fixed a bug where the guessed bounding box for datasets that do not start at (0,0,0) was too large. [#3437](https://github.com/scalableminds/webknossos/pull/3437)
- Fixed a bug where dataset list refresh failed when datasets for non-existing organizations were reported. [#3438](https://github.com/scalableminds/webknossos/pull/3438)
- Editing team access rights for datasets now works even if the datastore has no disk write access. [#3411](https://github.com/scalableminds/webknossos/pull/3411)
- Fixed a bug where the form values when editing TaskTypes were missing. [#3451](https://github.com/scalableminds/webknossos/pull/3451)
- Fixed a bug which caused RGB data to not render correctly. [#3455](https://github.com/scalableminds/webknossos/pull/3455)

### Removed

- Removed support to watch additional dataset directories, no longer automatically creating symbolic links to the main directory. [#3416](https://github.com/scalableminds/webknossos/pull/3416)

## [18.11.0](https://github.com/scalableminds/webknossos/releases/tag/18.11.0) - 2018-10-29

[Commits](https://github.com/scalableminds/webknossos/compare/18.10.0...18.11.0)

### Highlights

- Skeleton and volume tracings will be more unified, resulting in hybrid tracings that can contain both structures:
  - Hybrid tracings are now enabled by default. They allow to combine the functionality of skeleton and volume annotations in one tracing. [#3399](https://github.com/scalableminds/webknossos/pull/3399)
  - Old volume tracing versions now also can be restored. Access it through the dropdown next to the Save button. [#3349](https://github.com/scalableminds/webknossos/pull/3349)
- The tracing view was improved:
  - The info tab in tracing views now displays the extent of the current dataset. [#3371](https://github.com/scalableminds/webknossos/pull/3371).
  - A User can now have multiple layouts for tracing views. [#3299](https://github.com/scalableminds/webknossos/pull/3299)
  - More layouting improvements: [#3256](https://github.com/scalableminds/webknossos/pull/3256) [#3256](https://github.com/scalableminds/webknossos/pull/3256) [#3272](https://github.com/scalableminds/webknossos/pull/3272)

### Added

- Added support for duplicate dataset names for different organizations. [#3137](https://github.com/scalableminds/webknossos/pull/3137)
- Extended the version restore view and added a view to restore older versions of a volume tracing. Access it through the dropdown next to the Save button. [#3349](https://github.com/scalableminds/webknossos/pull/3349)
- Added support to watch additional dataset directories, automatically creating symbolic links to the main directory. [#3330](https://github.com/scalableminds/webknossos/pull/3330)
- Added a button to the users list view that revokes admin rights from all selected users. [#3378](https://github.com/scalableminds/webknossos/pull/3378)
- Hybrid tracings are now enabled by default. They allow to combine the functionality of skeleton and volume annotations in one tracing. [#3399](https://github.com/scalableminds/webknossos/pull/3399)
- A User can now have multiple layouts for tracing views. [#3299](https://github.com/scalableminds/webknossos/pull/3299)
- Added support for datasets with sparse resolutions (e.g., [[1, 1, 1], [16, 16, 16]]). [#3406](https://github.com/scalableminds/webknossos/pull/3406)
- The info tab in tracing views now displays the extent of the current dataset. [#3371](https://github.com/scalableminds/webknossos/pull/3371).

### Changed

- The UI for editing experience domains of users was improved. [#3254](https://github.com/scalableminds/webknossos/pull/3254)
- The tracing layout was changed to be more compact. [#3256](https://github.com/scalableminds/webknossos/pull/3256)
- It is no longer possible to draw outside of a viewport with the brush tool in volume tracing. [#3283](https://github.com/scalableminds/webknossos/pull/3283)
- There is now a separate tracingstore module, the datastore is no longer responsible for saving tracings. [#3281](https://github.com/scalableminds/webknossos/pull/3281)
- The version history view shows versions grouped by day and time now. [#3365](https://github.com/scalableminds/webknossos/pull/3365)
- Users can now access the annotations of other users (of the same organization) given the link, even if they are non-public. [#3348](https://github.com/scalableminds/webknossos/pull/3348)

### Fixed

- Fixed a layouting issue which occurred on a fresh page load when the layout was scaled to be bigger than the available space. [#3256](https://github.com/scalableminds/webknossos/pull/3256)
- Fixed overlap in comment tab for long tree names or comments. [#3272](https://github.com/scalableminds/webknossos/pull/3272)
- Fixed that CTRL + Shift + F opens two search popovers in the tracing view. Instead, the shortcut will only open the tree search now. [#3407](https://github.com/scalableminds/webknossos/pull/3407)
- Fixed a bug which caused data to not be displayed correctly if adjacent data does not exist.[#3270](https://github.com/scalableminds/webknossos/pull/3270)
- Fixed a bug which caused data to not be displayed correctly if adjacent data does not exist. [#3270](https://github.com/scalableminds/webknossos/pull/3270)
- Fixed a bug which caused initial rendering to sometimes miss some buckets. [#3262](https://github.com/scalableminds/webknossos/pull/3262)
- Fixed a bug which caused the save-button to never show success for volume tracings. [#3267](https://github.com/scalableminds/webknossos/pull/3267)
- Fixed a rendering bug which caused data to turn black sometimes when moving around. [#3409](https://github.com/scalableminds/webknossos/pull/3409)

## [18.10.0](https://github.com/scalableminds/webknossos/releases/tag/18.10.0) - 2018-09-22

[Commits](https://github.com/scalableminds/webknossos/compare/18.09.0...18.10.0)

### Highlights

- WebKnossos is documented now! Check it out: https://docs.webknossos.org [#3011](https://github.com/scalableminds/webknossos/pull/3011)
- There are multiple improvements of the tracing view:
  - Added customizable layouting to the tracing view. [#3070](https://github.com/scalableminds/webknossos/pull/3070)
  - Improved general performance of the tracing view by leveraging web workers. [#3162](https://github.com/scalableminds/webknossos/pull/3162)
  - Added a view to restore any older version of a skeleton tracing. Access it through the dropdown next to the Save button. [#3194](https://github.com/scalableminds/webknossos/pull/3194)
  - And more usability improvements: [#3126](https://github.com/scalableminds/webknossos/pull/3126), [#3066](https://github.com/scalableminds/webknossos/pull/3066)
- Project administration got some UI improvements: [#3077](https://github.com/scalableminds/webknossos/pull/3077), [#3224](https://github.com/scalableminds/webknossos/pull/3224), [#3233](https://github.com/scalableminds/webknossos/pull/3233)
- Improved security by enabling http security headers. [#3084](https://github.com/scalableminds/webknossos/pull/3084)

### Added

- Added URLs to the tabs in the dashboard. [#3183](https://github.com/scalableminds/webknossos/pull/3183)
- Improved security by enabling http security headers. [#3084](https://github.com/scalableminds/webknossos/pull/3084)
- Added the possibility to write markdown in the annotation description. [#3081](https://github.com/scalableminds/webknossos/pull/3081)
- Added a view to restore any older version of a skeleton tracing. Access it through the dropdown next to the Save button. [#3194](https://github.com/scalableminds/webknossos/pull/3194)
  ![version-restore-highlight](https://user-images.githubusercontent.com/1702075/45428378-6842d380-b6a1-11e8-88c2-e4ffcd762cd5.png)
- Added customizable layouting to the tracing view. [#3070](https://github.com/scalableminds/webknossos/pull/3070)
- Added the brush size to the settings on the left in volume tracing. The size can now also be adjusted by using only the keyboard. [#3126](https://github.com/scalableminds/webknossos/pull/3126)
- Added a user documentation for webKnossos [#3011](https://github.com/scalableminds/webknossos/pull/3011)
- Tree groups can now be activated. This allows to rename a tree group analogous to renaming a tree. Also, toggling the visibility of a tree group can now be done by using the shortcuts "1" and "2". [#3066](https://github.com/scalableminds/webknossos/pull/3066)
- Added the possibility to upload multiple NML files during task creation, even if they are not in a zip archive
- Added the possibility to supply a dedicated "sorting date" for datasets to change the sorting order in the gallery view, by default the creation date is used [#3124](https://github.com/scalableminds/webknossos/pull/3124)
- Added bar-chart visualization to project progress report. [#3224](https://github.com/scalableminds/webknossos/pull/3224)
- Added a button to collapse all comments. [#3215](https://github.com/scalableminds/webknossos/pull/3215)
- The datasets in the dashboard are now sorted according to their user-specific usage. As a result, relevant datasets should appear at the top of the list. [#3206](https://github.com/scalableminds/webknossos/pull/3206)
- 3D Meshes can now be imported into the tracing view by uploading corresponding STL files. [#3242](https://github.com/scalableminds/webknossos/pull/3242)

### Changed

- The modal used to change the experience of users by admins got a rework. [#3077](https://github.com/scalableminds/webknossos/pull/3077)
- During task creation, specifying an experience domain is now possible by choosing from existing domains. [#3233](https://github.com/scalableminds/webknossos/pull/3233)
- Unified the search functionality within webKnossos to implement an AND logic everyhwere. [#3228](https://github.com/scalableminds/webknossos/pull/3228)
- Renamed "Soma Clicking" to "Single-Node-Tree Mode". [#3141](https://github.com/scalableminds/webknossos/pull/3141/files)
- The fallback segmentation layer attribute of volume tracings is now persisted to NML/ZIP files. Upon re-upload, only volume tracings with this attribute will show a fallback layer. Use `tools/volumeAddFallbackLayer.py` to add this attribute to existing volume tracings. [#3088](https://github.com/scalableminds/webknossos/pull/3088)
- When splitting a tree, the split part that contains the initial node will now keep the original tree name and id. [#3145](https://github.com/scalableminds/webknossos/pull/3145)
- Improve error messages for parsing faulty NMLs. [#3227](https://github.com/scalableminds/webknossos/pull/3227)
- Finished tasks will be displayed with less details and sorted by their finishing date in the dashboard. [#3202](https://github.com/scalableminds/webknossos/pull/3202)
- Improved layouting for narrow screens. [#3226](https://github.com/scalableminds/webknossos/pull/3226)
- The welcome header will now also show on the default page if there are no existing organisations. [#3133](https://github.com/scalableminds/webknossos/pull/3133)
- Simplified the sharing of tracings. Users can simply copy the active URL from the browser's URL bar to share a tracing (assuming the tracing is public). [#3176](https://github.com/scalableminds/webknossos/pull/3176)
- Improved general performance of the tracing view by leveraging web workers. [#3162](https://github.com/scalableminds/webknossos/pull/3162)
- Improved overall drag-and-drop behavior by preventing the browser from opening the dragged file when the actual drag target was missed. [#3222](https://github.com/scalableminds/webknossos/pull/3222)
- The checkboxes in the user list view will clear now after the experience domains of users have been changed. [#3178](https://github.com/scalableminds/webknossos/pull/3178)
- Resetting a user's task requires a confirmation now. [#3181](https://github.com/scalableminds/webknossos/pull/3181)

### Fixed

- Fixed a bug where large volume downloads contained invalid data.zip archives. [#3086](https://github.com/scalableminds/webknossos/pull/3086)
- Fixed the sorting of the dashboard task list and explorative annotation list. [#3153](https://github.com/scalableminds/webknossos/pull/3153)
- Fixed a missing notification when a task annotation was reset. [#3207](https://github.com/scalableminds/webknossos/pull/3207)
- Fixed a bug where non-privileged users were wrongly allowed to pause/unpause projects. [#3097](https://github.com/scalableminds/webknossos/pull/3097)
- Fixed a bug in copy-segmentation-slice feature. [#3245](https://github.com/scalableminds/webknossos/pull/3245)
- Fixed a regression bug which caused the initial data loading to fail sometimes. [#3149](https://github.com/scalableminds/webknossos/pull/3149)
- Fixed a bug which caused a blank screen sometimes when the user is not logged in. [#3167](https://github.com/scalableminds/webknossos/pull/3167)
- Fixed a bug where NML downloads of Task Annotations failed. [#3166](https://github.com/scalableminds/webknossos/pull/3166)
- Fixed a bug where viewing Compound Annotations (such as all tasks for a project in one view) failed. [#3174](https://github.com/scalableminds/webknossos/pull/3174)

### Removed

- Removed the automatic redirect to the onboarding page from the default page if there are no existing organisations. [#3133](https://github.com/scalableminds/webknossos/pull/3133)

## [18.09.0](https://github.com/scalableminds/webknossos/releases/tag/18.09.0) - 2018-08-20

[Commits](https://github.com/scalableminds/webknossos/compare/18.08.0...18.09.0)

### Highlights

- The dashboard gallery loads faster [#3036](https://github.com/scalableminds/webknossos/pull/3036) and tracings in the dashboard can show their descriptions [#3035](https://github.com/scalableminds/webknossos/pull/3035).
- Managing new users got easier through "new inactive users" notifications [#2994](https://github.com/scalableminds/webknossos/pull/2994), and also team managers can activate them now [#3050](https://github.com/scalableminds/webknossos/pull/3050).
- Improved the UI for sharing datasets and tracings [#3029](https://github.com/scalableminds/webknossos/pull/3029).
- The tracing view got a progress-indicator [#2935](https://github.com/scalableminds/webknossos/pull/2935) and scale-bars [#3049](https://github.com/scalableminds/webknossos/pull/3049).
- When merging datasets within a tracing via the merge-modal, the user can choose whether the merge should be executed directly in the currently opened tracing. Alternatively, a new annotation can be created which is accessible via the dashboard, as before [#2935](https://github.com/scalableminds/webknossos/pull/2935).

### Added

- Added two new properties to mapping json files. The `colors: [<hsvHueValue1>, <hsvHueValue2>, ...]` property can be used to specify up to 256 custom colors for the first 256 equivalence classes of the mapping. The `hideUnmappedIds: <true|false>` property indicates whether segments that were not mapped should be rendered transparently or not. [#2965](https://github.com/scalableminds/webknossos/pull/2965)
- Added a button for refreshing the dataset in the backend cache. [#2975](https://github.com/scalableminds/webknossos/pull/2975)
- Added the possibility to see the description of a tracing within the dashboard. [#3035](https://github.com/scalableminds/webknossos/pull/3035)
- Comments of tracing trees can now be cycled through by keeping n and p pressed. [#3041](https://github.com/scalableminds/webknossos/pull/3041)
- All dates in webknossos will be shown in the browser's timezone. On hover, a tooltip will show the date in UTC. [#2916](https://github.com/scalableminds/webknossos/pull/2916) ![image](https://user-images.githubusercontent.com/2486553/42888385-74c82bc0-8aa8-11e8-9c3e-7cfc90ce93bc.png)
- When merging datasets within a tracing via the merge-modal, the user can choose whether the merge should be executed directly in the currently opened tracing. Alternatively, a new annotation can be created which is accessible via the dashboard (as it has been before).
- Added shortcuts for moving along the current tracing direction in orthogonal mode. Pressing 'e' (and 'r' for the reverse direction) will move along the "current direction", which is defined by the vector between the last two created nodes.
- Added a banner to the user list to notify admins of new inactive users that need to be activated. [#2994](https://github.com/scalableminds/webknossos/pull/2994)
- When a lot of changes need to be persisted to the server (e.g., after importing a large NML), the save button will show a percentage-based progress indicator.
- Changing tabs in a tracing view will not disable the keyboard shortcuts anymore. [#3042](https://github.com/scalableminds/webknossos/pull/3042)
- Added the possibility for admins to see and transfer all active tasks of a project to a single user in the project tab[#2863](https://github.com/scalableminds/webknossos/pull/2863)
- Added the possibility to import multiple NML files into the active tracing. This can be done by dragging and dropping the files directly into the tracing view. [#2908](https://github.com/scalableminds/webknossos/pull/2908)
- Added placeholders and functionality hints to (nearly) empty lists and tables in the admin views. [#2969](https://github.com/scalableminds/webknossos/pull/2969)
- Added the possibility to copy volume tracings to own account
- During the import of multiple NML files, the user can select an option to automatically create a group per file so that the imported trees are organized in a hierarchy. [#2908](https://github.com/scalableminds/webknossos/pull/2908)
- Added the option to display scale bars in the viewports for orthogonal mode. [#3049](https://github.com/scalableminds/webknossos/pull/3049)
- Added functions to the front-end API to activate a tree and to change the color of a tree. [#2997](https://github.com/scalableminds/webknossos/pull/2997)
- When a new team or project is created, invalid names will be directly marked in red. [#3034](https://github.com/scalableminds/webknossos/pull/3034)
- Added an error message to the NML upload if the needed permissions are missing for the upload. [#3051](https://github.com/scalableminds/webknossos/pull/3051)
- Comments can now contain references to nodes (`#<nodeid>`) or positions (`#(<x,y,z>)`). Clicking on such a reference activates the respective node or position and centers it. [#2950](https://github.com/scalableminds/webknossos/pull/2950)
- Added a default text to the task view to indicate, that no users are assigned to a task. [#3030](https://github.com/scalableminds/webknossos/issues/3030)

### Changed

- Added a checkbox to disable the warning when deleting a tree. An accidentally deleted tree can easily be restored using the Undo functionality. [#2995](https://github.com/scalableminds/webknossos/pull/2995)
- Improved the UI for sharing datasets and tracings. [#3029](https://github.com/scalableminds/webknossos/pull/3029)
- Team managers are now allowed to activate users (previously admin-only) [#3050](https://github.com/scalableminds/webknossos/pull/3050)
- Improved the loading time of datasets in the dashboard. [#3036](https://github.com/scalableminds/webknossos/pull/3036)

### Fixed

- Fixed a bug where unloaded data was sometimes shown as black instead of gray. [#2963](https://github.com/scalableminds/webknossos/pull/2963)
- Fixed that URLs linking to a certain position in a dataset or tracing always led to the position of the active node. [#2960](https://github.com/scalableminds/webknossos/pull/2960)
- Fixed that setting a bounding box in view mode did not work. [#3015](https://github.com/scalableminds/webknossos/pull/3015)
- Fixed a bug where viewing Compound Annotations (such as viewing all instances of a task at once) failed with a permission issue. [#3023](https://github.com/scalableminds/webknossos/pull/3023)
- Fixed that the segmentation layer is loaded from the server even when the segmentation opacity is set to 0. [#3067](https://github.com/scalableminds/webknossos/pull/3067)
- Fixed a bug where the team name was not displayed in the task types view of admins. [#3053](https://github.com/scalableminds/webknossos/pull/3053)

## [18.08.0](https://github.com/scalableminds/webknossos/releases/tag/18.08.0) - 2018-07-23

[Commits](https://github.com/scalableminds/webknossos/compare/18.07.0...18.08.0)

### Highlights

- Performance improvements for the tracing views. #2709 #2724 #2821
- Added onboarding flow for initial setup of WebKnossos. #2859
- The dataset gallery got a redesign with mobile support. #2761
- Improved the import dialog for datasets. Important fields can now be edited via form inputs instead of having to change the JSON. The JSON is still changeable when enabling an "Advanced" mode. #2881
- Added possibility to share a special link to invite users to join your organization. Following that link, the sign-up form will automatically register the user for the correct organization. #2898

### Added

- Added release version to navbar [#2888](https://github.com/scalableminds/webknossos/pull/2888)
- Users can view datasets in a table from the dashboard. That view also allows to create explorational tracings (which had to be done via the gallery view for non-admins before). [#2866](https://github.com/scalableminds/webknossos/pull/2866)
- Added the task bounding box of a skeleton tracing to NML files. [#2827](https://github.com/scalableminds/webknossos/pull/2827) \
   Example: `<taskBoundingBox topLeftX="0" topLeftY="0" topLeftZ="0" width="512" height="512" depth="512" />`
- Added the possibility to kick a user out of the organization team. [#2801](https://github.com/scalableminds/webknossos/pull/2801)
- Added a mandatory waiting interval of 10 seconds when getting a task with a new task type. The modal containing the task description cannot be closed earlier. These ten seconds should be used to fully understand the new task type. [#2793](https://github.com/scalableminds/webknossos/pull/2793)
- Added possibility to share a special link to invite users to join your organization. Following that link, the sign-up form will automatically register the user for the correct organization. [#2898](https://github.com/scalableminds/webknossos/pull/2898)
- Added more debugging related information in case of unexpected errors. The additional information can be used when reporting the error. [#2766](https://github.com/scalableminds/webknossos/pull/2766)
- Added permission for team managers to create explorational tracings on datasets without allowed teams. [#2758](https://github.com/scalableminds/webknossos/pull/2758)
- Added higher-resolution images for dataset gallery thumbnails. [#2745](https://github.com/scalableminds/webknossos/pull/2745)
- Added permission for admins to get tasks from all projects in their organization. [#2728](https://github.com/scalableminds/webknossos/pull/2728)
- Added the shortcut to copy the currently hovered cell id (CTRL + I) to non-volume-tracings, too. [#2726](https://github.com/scalableminds/webknossos/pull/2726)
- Added permission for team managers to refresh datasets. [#2688](https://github.com/scalableminds/webknossos/pull/2688)
- Added backend-unit-test setup and a first test for NML validation. [#2829](https://github.com/scalableminds/webknossos/pull/2829)
- Added progress indicators to the save button for cases where the saving takes some time (e.g., when importing a large NML). [#2947](https://github.com/scalableminds/webknossos/pull/2947)
- Added the possibility to not sort comments by name. When clicking the sort button multiple times, sorting is switched to sort by IDs. [#2915](https://github.com/scalableminds/webknossos/pull/2915)
- Added displayName for organizations. [#2869](https://github.com/scalableminds/webknossos/pull/2869)
- Added onboarding flow for initial setup of WebKnossos. [#2859](https://github.com/scalableminds/webknossos/pull/2859)
- Added the possibility to show the task in a random order. [#2860](https://github.com/scalableminds/webknossos/pull/2860)

### Changed

- Improved the search functionality in the datasets view. The datasets will be sorted so that the best match is shown first. If a different sorting is desired, the sorting-arrows in the columns can still be used to change the sorting criteria. [#2834](https://github.com/scalableminds/webknossos/pull/2834)
- Improved performance in orthogonal mode. [#2821](https://github.com/scalableminds/webknossos/pull/2821)
- When deleting the last node of a tree, that tree will not be removed automatically anymore. Instead, the tree will just be empty. To remove that active tree, the "delete" shortcut can be used again. [#2806](https://github.com/scalableminds/webknossos/pull/2806)
- Renamed "Cancel" to "Reset and Cancel" for tasks. [#2910](https://github.com/scalableminds/webknossos/pull/2910)
- Changed the type of the initial node of new tasks to be a branchpoint (if not created via NML). [#2799](https://github.com/scalableminds/webknossos/pull/2799)
- The dataset gallery got a redesign with mobile support. [#2761](https://github.com/scalableminds/webknossos/pull/2761)
- Improved the performance of saving large changes to a tracing (e.g., when importing a large NML). [#2947](https://github.com/scalableminds/webknossos/pull/2947)
- Improved loading speed of buckets. [#2724](https://github.com/scalableminds/webknossos/pull/2724)
- Changed the task search, when filtered by user, to show all instead of just active tasks (except for canceled tasks). [#2774](https://github.com/scalableminds/webknossos/pull/2774)
- Improved the import dialog for datasets. Important fields can now be edited via form inputs instead of having to change the JSON. The JSON is still changeable when enabling an "Advanced" mode. [#2881](https://github.com/scalableminds/webknossos/pull/2881)
- Hid old paused projects in the project progress report even if they have open instances. [#2768](https://github.com/scalableminds/webknossos/pull/2768)
- Excluded canceled tasks and base tracings from the list at `api/projects/:name/usersWithOpenTasks`. [#2765](https://github.com/scalableminds/webknossos/pull/2765)
- Streamlined the order in which initial buckets are loaded when viewing a dataset. [#2749](https://github.com/scalableminds/webknossos/pull/2749)
- Reduced the number of scenarios in which segmentation-related warnings are shown (e.g, not for skeleton tracings when there are multiple resolutions for segmentations anyway). [#2715](https://github.com/scalableminds/webknossos/pull/2715)
- Email addresses for notifications about new users and about task overtime are no longer specified instance-wide but once per organization. [#2939](https://github.com/scalableminds/webknossos/pull/2939)
- Improved tracing view page load performance by decreasing WebGL shader compilation time. [#2709](https://github.com/scalableminds/webknossos/pull/2709)
- Improved error reporting for project progress page. [#2955](https://github.com/scalableminds/webknossos/pull/2955)
- Redesigned the user task list to make it easier to read the whole task description. [#2861](https://github.com/scalableminds/webknossos/pull/2861)

### Fixed

- Fixed a bug which caused segmentation data to be requested as four-bit when four-bit-mode was enabled. [#2828](https://github.com/scalableminds/webknossos/pull/2828)
- Fixed a bug where possible comments or branchpoints sometimes were not properly deleted when deleting a node. [2897](https://github.com/scalableminds/webknossos/pull/2897)
- Fixed a bug which caused projects to be unpaused when the project priority was changed. [#2795](https://github.com/scalableminds/webknossos/pull/2795)
- Fixed an unnecessary warning when deleting a tree in a task, that warned about deleting the initial node although the initial node was not contained in the deleted tree. [#2812](https://github.com/scalableminds/webknossos/pull/2812)
- Fixed a bug where the comment tab was scrolled into view horizontally if a node with a comment was activated. [#2805](https://github.com/scalableminds/webknossos/pull/2805)
- Fixed a bug in for Firefox users where a long tree list created an unnecessary scroll region. [#2787](https://github.com/scalableminds/webknossos/pull/2787)
- Fixed clicking on a task type within the task list page, so that the task type page will actually only show the linked task type. [#2769](https://github.com/scalableminds/webknossos/pull/2769)
- Fixed clicking on a project within the task list page, so that the project page will actually only show the linked project. [#2759](https://github.com/scalableminds/webknossos/pull/2759)
- Fixed a bug in the front-end API's `setMapping` call which caused ignored calls if the provided object was mutated. [#2921](https://github.com/scalableminds/webknossos/pull/2921)
- Fixed a bug where cell IDs in the segmentation tab were not shown for all zoomsteps. [#2726](https://github.com/scalableminds/webknossos/pull/2726)
- Fixed the naming of the initial tree in tasks. [#2689](https://github.com/scalableminds/webknossos/pull/2689)
- Fixed a regression affecting node selection, shortcuts and 3d viewport navigation. [#2673](https://github.com/scalableminds/webknossos/pull/2673)
- Fixed the dataset zip upload for datasets, which only have one data layer and no config file. [#2840](https://github.com/scalableminds/webknossos/pull/2840)
- Fixed a bug where task deletion broke the task listing for users who had active annotations for the task [#2884](https://github.com/scalableminds/webknossos/pull/2884)
- Fixed that decimal scales (e.g., 11.24, 11.24, 30) couldn't be defined for datasets in "simple" mode. [#2912](https://github.com/scalableminds/webknossos/pull/2912)

## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05

First release
