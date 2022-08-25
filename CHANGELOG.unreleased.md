# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/22.08.0...HEAD)

### Added
- The owner of an annotation can allow other users, who may see the annotation, to also edit it. Note that parallel writes are not supported and would lead to conflicts. [#6236](https://github.com/scalableminds/webknossos/pull/6236)
- WebKnossos now remembers the tool that was active in between disabling and enabling the segmentation layer. [#6362](https://github.com/scalableminds/webknossos/pull/6362)
- Segmentation layers which were not previously editable now show an (un)lock icon button which shortcuts to the Add Volume Layer modal with the layer being preselected. [#6330](https://github.com/scalableminds/webknossos/pull/6330)
- The NML file in volume annotation download now includes segment metadata like names and anchor positions. [#6347](https://github.com/scalableminds/webknossos/pull/6347)
- Added an "extrude segment" feature which is similar to the old "copy from previous slice" feature. The segment interpolation and the new segment extrusion feature are both available via the toolbar (see the dropdown icon which was added to the old interpolation button). [#6370](https://github.com/scalableminds/webknossos/pull/6370)
- Added support for ad-hoc meshing for volume annotation layers with fallback segmentations. [#6369](https://github.com/scalableminds/webknossos/pull/6369)
- Added new backend API route for requesting all publications. Those publications can now have also attached annotations. [#6315](https://github.com/scalableminds/webknossos/pull/6315)
- Added support for 64-bit segmentations (uint64). Note that the actual support only covers IDs up to 2^53 - 1 (matches the JavaScript number type). Also note that JSON mappings are only compatible with segment ids which only use the lower 32 bits. [#6317](https://github.com/scalableminds/webknossos/pull/6317)
- Added a "duplicate" button for annotations. [#6386](https://github.com/scalableminds/webknossos/pull/6386)
- Added new filter options for the dataset list api at `api/datasets`: `organizationName: String`, `onlyMyOrganization: Boolean`, `uploaderId: String` [#6377](https://github.com/scalableminds/webknossos/pull/6377)
- The Add Dataset view now hosts an Add Zarr Dataset tab to explore, configure and import remote Zarr datasets. [#6335](https://github.com/scalableminds/webknossos/pull/6335)
- Added a UI to manage Zarr links for an annotation so that the annotation can be streamed to 3rd party tools. This change also includes new backend API routes for using the (private) zarr links to annotations as well as creating them. [#6367](https://github.com/scalableminds/webknossos/pull/6367)
- Zarr-based remote dataset import now also works for public AWS S3 endpoints with no credentials. [#6421](https://github.com/scalableminds/webknossos/pull/6421)

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
- Annotation Type was removed from the info tab. [#6330](https://github.com/scalableminds/webknossos/pull/6330)
- Removed the possibility to load data from foreign webKnossos datastores. Use Zarr streaming instead. [#6392](https://github.com/scalableminds/webknossos/pull/6392)

### Breaking Changes
