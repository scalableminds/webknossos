# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/25.05.1...HEAD)

### Added
- Meshes of Neuroglancer Precomputed Datasets can now be viewed. [#8236](https://github.com/scalableminds/webknossos/pull/8236)
- Added the possibility to join an organization without requiring a paid user slot in case an organization already pays for the same user. Such a user is called a "Guest User". [#8502](https://github.com/scalableminds/webknossos/pull/8502)
- Added that "Create Animation" jobs will now use the correct segment colors for rendering meshes. [#8605](https://github.com/scalableminds/webknossos/pull/8605)
- In the NML upload route, the additional form field `description` can be specified. If so, it will overwrite the description contained in the NML files. [#8631](https://github.com/scalableminds/webknossos/pull/8631)
- Added the possibility for super users to retry manually cancelled jobs from the jobs list. [#8629](https://github.com/scalableminds/webknossos/pull/8629)
- Added checkboxes to the segments tab that allow to show/hide individual segments. The visibility of segments that are not listed in the segments list can be controlled with a new "Hide unlisted segments" toggle in the layer settings. Additionally, you can right-click a segment in a data viewport and select "Only show this segment" (and similar functionality). [#8546](https://github.com/scalableminds/webknossos/pull/8546)
- Instead of pasting a dataset position from the clipboard to the position input box, you can simply paste it without focussing the position input first. Furthermore, you can also paste a "hash string", such as `#1406,1794,1560,0,0.234,186`, as it can be found in WK URLs. Pasting such a string will also set the encoded zoom, rotation, viewport etc. Note that the `#` has to be included in the pasted text. You can also copy and paste an entire link, but note that the dataset or annotation id in the link will be ignored. [#8652](https://github.com/scalableminds/webknossos/pull/8652)
- In shared annotations with multiple authors, some changes are now stored per user. This means that other users won’t see all those changes if their own diverge. This includes the current position and zoom, visibilities of trees, bounding boxes, and segments (as specified with the checkboxes in the lists), as well as which groups are expanded in the lists. The annotation owner’s user state is used as a fallback for users who haven’t explicitly changed these values themselves. [#8542](https://github.com/scalableminds/webknossos/pull/8542)

### Changed
- Remove `data.maybe` dependency and replaced with regular Typescript types. [#8563](https://github.com/scalableminds/webknossos/pull/8563)
- Updated `View Modes` documentation page with links for mouse and keyboard shortcuts. [#8582](https://github.com/scalableminds/webknossos/pull/8582)
- Renamed the button to view the compound annotation of all tasks of a tasktype to be more descriptive. [#8565](https://github.com/scalableminds/webknossos/pull/8565)
- Replaced fixed threshold of 40 meshes by a dynamic limit based on the number of triangles in the mesh for the "Create Animation" job. [#8588](https://github.com/scalableminds/webknossos/pull/8588)
- Replaced Redux selector `useSelector((state: OxalisState) => ...)` with a typed `useWkSelector(state => ...)` shorthand. [#8591](https://github.com/scalableminds/webknossos/pull/8591)
- Renamed `OxalisState`, `OxalisApplication`, and `OxalisApi` to their respective `Webknossos{State, API, Application}` equivalent [#8591](https://github.com/scalableminds/webknossos/pull/8591)
- Renamed `frontend/javascripts/oxalis` to `frontend/javascripts/viewer`. [#8601](https://github.com/scalableminds/webknossos/pull/8601)
- When loading data from a data layer that has data stored beyond the bounding box specified in the datasource-properties.json, data outside of the bounding box is now zeroed. (the layer is “clipped”). [#8551](https://github.com/scalableminds/webknossos/pull/8551)
- Updated to Typescript from version `5.5` to `5.8`. [#8613](https://github.com/scalableminds/webknossos/pull/8613)
- Updated Voxelytics log streaming to also include the `log_path` attribute. [#8615](https://github.com/scalableminds/webknossos/pull/8615)
- When creating or uploading a non-task volume annotation layer with a fallback segmentation layer, the annotation layer’s bounding box will now be limited to that layer’s, instead of the whole dataset’s. [#7580](https://github.com/scalableminds/webknossos/pull/7580)
- Refactored the `skeletonTracing.TreeMap` structure to use `DiffableMap` type. [#8626](https://github.com/scalableminds/webknossos/pull/8626)

### Fixed
- When selecting a skeleton node in a viewport, its tree is focused and scrolled to in the skeleton tab, even if its parent group was collapsed before. [#8585](https://github.com/scalableminds/webknossos/pull/8585)
- Fixed that the minimum size of bounding boxes for AI neuron and mitochondria inferral was not checked before starting the job. [#8561](https://github.com/scalableminds/webknossos/pull/8561)
- Fixed that layer bounding boxes were sometimes colored green even though this should only happen for tasks. [#8535](https://github.com/scalableminds/webknossos/pull/8535)
- Fixed that annotations could not be opened anymore (caused by #8535). [#8599](https://github.com/scalableminds/webknossos/pull/8599)
- Voxels outside of the layer bounding box cannot be brushed, anymore. [#8602](https://github.com/scalableminds/webknossos/pull/8602)
- The guest tag is now also shown for guest admin users. [#8612](https://github.com/scalableminds/webknossos/pull/8612)
- Fixed a rare bug where segment bounding box would not be displayed correctly, with the request potentially even crashing the server. [#8590](https://github.com/scalableminds/webknossos/pull/8590)
- Fixed a rare bug where download requests would terminate without sending the whole annotation. [#8624](https://github.com/scalableminds/webknossos/pull/8624)
- Fixed that deletion of dataset would lead to an error. [#8639](https://github.com/scalableminds/webknossos/pull/8639)
- Fixed a bug where merging annotations with large tree IDs could lead to an error. [#8643](https://github.com/scalableminds/webknossos/pull/8643)
- Fixed that the segment stats were sometimes not displayed in the context menu. [#8645](https://github.com/scalableminds/webknossos/pull/8645)
- Fixed a bug in zarr streaming where directly after the datastore startup, chunk responses would have status 404 (leading zarr clients to fill with fill_value). Now it will yield status 503, so that clients can retry or escalate this as an error. [#8644](https://github.com/scalableminds/webknossos/pull/8644)
- Improved efficiency of saving bounding box related changes. [#8492](https://github.com/scalableminds/webknossos/pull/8492)
- Fixed regression which caused the import of trees (also of agglomerate skeletons) to crash if the annotation was not empty. [#8656](https://github.com/scalableminds/webknossos/pull/8656)
- Fixed that one could activate unavailable tools or toolkits in read-only mode. [#8658](https://github.com/scalableminds/webknossos/pull/8658)

### Removed
- The old "Selective Segment Visibility" feature that allowed to only see the active and the hovered segment was removed. From now on the visibility of segments can be controlled with checkboxes in the segment list and with the "Hide unlisted segments" toggle in the layer settings. [#8546](https://github.com/scalableminds/webknossos/pull/8546)

### Breaking Changes
