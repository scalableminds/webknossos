---
title: "Changelog WEBKNOSSOS"
---

## Version 26.01

### Voxel pipette

We generalized the old "Segment Picker" tool to be a "Voxel Pipette" tool which can show the data values for all visible layers in a tooltip. The old behavior for activating a segment ID can still be achieved by pressing Shift. [#8989](https://github.com/scalableminds/webknossos/pull/8989)

![voxel pipette](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/a/4/a44a7cd2e372d08c1aa6b0ec867e8ea6ee9f3fa9.gif)

### Surface area

The surface area of a segment can now be shown in the context menu. [#8928](https://github.com/scalableminds/webknossos/pull/8928)

![surface area](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/c/2/c292b38422033308a39fc3f0c34edb3e730ebc2e.gif)

### Multi cut mode

We added a new multi cut mode to the proofreading tool, allowing more precise agglomerate splits. Instead of marking just one point per partition, users can now specify multiple points for each side of the split before performing the cut. [#8824](https://github.com/scalableminds/webknossos/pull/8824)

![split proofreading](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/8/1/8103774b467c36290777bb7798be1a644bcdf828.gif)

### Live view update in shared annotations

When you are viewing an annotation and another user changes that annotation, these changes will be automatically shown. For some changes (e.g., when adding a new annotation layer), you will still need to reload the page, but most of the time WEBKNOSSOS will update the annotation automatically. [#8648](https://github.com/scalableminds/webknossos/pull/8648)

![live updates shared annotations](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/5/f/5f76b5193533445873a0f5ffb290a527c5dfc04c.gif)

### Segment visibility

Checkboxes in the segments tab now allow to show/hide individual segments. The visibility of segments that are not listed in the segments list can be controlled with a new "Hide unlisted segments" toggle in the layer settings. Additionally, you can right-click a segment in a data viewport and select "Only show this segment" (and similar functionality). [#8546](https://github.com/scalableminds/webknossos/pull/8546)

![hide selected segments](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/8/9/89af5a647facc65bd9781a3aa11bdbc702451582.gif)

### Paste location in UI

Instead of pasting a dataset position from the clipboard to the position input box, you can simply paste it without focussing the position input first. Furthermore, you can also paste a "hash string", such as `#1406,1794,1560,0,0.234,186`, as it can be found in WK URLs. Pasting such a string will also set the encoded zoom, rotation, viewport etc. Note that the `#` has to be included in the pasted text. You can also copy and paste an entire link, but note that the dataset or annotation id in the link will be ignored. [#8652](https://github.com/scalableminds/webknossos/pull/8652)

![paste position anywhere](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/2/0/201867e466a3e719764ff5cf7272b83c2fe1f892.gif)

### Toolkits concept

We added the concept of "toolkits". By default, all tools are available to the user (as before), but one can select a specific toolkit to only see certain tools. Some toolkits also change the behavior of the tools. For example, the "Split Segments" toolkit (see below). [#8434](https://github.com/scalableminds/webknossos/pull/8434)

### Split segments toolkit

There is now a toolkit for splitting segments (also see [documentation](https://docs.webknossos.org/webknossos/proofreading/split_segments_toolkit.html)). Select the "Split Segments" toolkit and create a bounding box in which you want to execute the split. Then, use the skeleton tool to place nodes on the boundary between two (merged) segments. The nodes will be used to construct a 3D surface. Finally, use the floodfill tool (enable 3D and bounding-box restriction) to relabel a part of the segment. The floodfill won't cross the 3D surface. [#8434](https://github.com/scalableminds/webknossos/pull/8434)

<https://www.youtube.com/watch?v=iABtD7YQ9Rw>

### Mesh opacity

The opacity of meshes can be adjusted using the 'Change Segment Color' context menu entry in the segments tab. [#8443](https://github.com/scalableminds/webknossos/pull/8443)

![transparent meshes](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/f/5/f51b078ff05ff2df0e236f602d6194876b4bcc80.gif)

### Dataset mirroring

Users can now mirror datasets along an axis in the dataset settings as part of the rotation feature. [#8485](https://github.com/scalableminds/webknossos/pull/8485)

### Command palette

We added a command palette that allows navigating between pages, switching tools and accessing some user settings via Ctrl+P. Let us know if you want more actions accessible through the command palette. [#8447](https://github.com/scalableminds/webknossos/pull/8447/)

![command palette](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/6/0/602ea858ab162fc84a2e3978eb1fc779a77ccaa7.gif)

### Deleting datasets

Multiple datasets can be deleted at once. This can be done by selecting the datasets in the dashboard and clicking "Delete datasets" in the sidebar. [#9107](https://github.com/scalableminds/webknossos/pull/9107)

![deleting multiple datasets](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/4/0/40f96025734f1fe1719a34fdb8a13016596f0557.gif)

### AI Analysis UI

We added a new "Analysis" menu to the navbar and moved the AI Models, Processing Jobs and Voxelytics pages to it. [#9091](https://github.com/scalableminds/webknossos/pull/9091)

Also, the UI for starting AI jobs for running and training models and alignment has been redesigned. [#8873](https://github.com/scalableminds/webknossos/pull/8873)

![analysis menu](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/f/4/f405c2a46c8b92246570c2cf482857e5732ea9e9.gif)

[Read the full changelog](https://github.com/scalableminds/webknossos/releases/tag/23.02.0) : [Releases · scalableminds/webknossos · GitHub](https://github.com/scalableminds/webknossos/releases)
