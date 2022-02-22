# Changelog (Released)

All notable user-facing changes to webknossos are documented in this file.
See `CHANGELOG.unreleased.md` for the changes which are not yet part of an official release.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

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
- Fixed a security vulnerability by upgrading log4j to newest version. [#5900](https://github.com/scalableminds/webknossos/pull/5900)

### Breaking Change
- When using the front-end API, functions that accept a layer name, such as `api.data.getDataValue`, won't interpret the name "segmentation" as the current volume tracing if it exists. Instead, "segmentation" can only be used if the current dataset has a layer which is named "segmentation". If you want to interact with the volume tracing layer, use `api.data.getVolumeTracingLayerIds()` instead. Also see `api.data.getSegmentationLayerNames` and `api.data.getVisibleSegmentationLayer`. [#5771](https://github.com/scalableminds/webknossos/pull/5771)
- The datastore server routes `/datasets/reserveUpload` and `/datasets/finishUpload` now expect the additional field `layersToLink`, which should be an empty list by default. [#5863](https://github.com/scalableminds/webknossos/pull/5863


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
- Added the possibility to load the skeletons of specific agglomerates from an agglomerate file when opening a tracing by including a mapping and agglomerate ids in the URL hash. See the [docs](https://docs.webknossos.org/webknossos/sharing.html#sharing-link-format) for further information. [#5738](https://github.com/scalableminds/webknossos/pull/5738)
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
- Clicking outside of the context menu closes it without performing any other action (e.g., previously, a node could be created when clicking outside of the context menu, when the skeleton tool was active). Also, a repeated rightclick doesn't open the context menu again. [#5658](https://github.com/scalableminds/webknossos/pull/5658)
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
- The Historgram now has a correct linear scale. [#4926](https://github.com/scalableminds/webknossos/pull/4926)

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
- Fixed an error that occured when changing the URL hash. [#3746](https://github.com/scalableminds/webknossos/pull/3746)
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
