---
title: "Changelog WEBKNOSSOS"
---

## Version 26.08

### Layer transforms

Layer transforms — translation, rotation, and scaling — can now be edited live while viewing or annotating data. [#9664](https://github.com/scalableminds/webknossos/pull/9664)

<https://www.youtube.com/watch?v=l40tlFHwoVc>

### Maximum Intensity Projection

Maximum Intensity Projection (MIP) rendering is now available for bounding boxes in the 3D viewport. Right-click any bounding box and choose "Render as MIP" to project a data layer through the volume, displaying the highest intensity value along each ray. [#9584](https://github.com/scalableminds/webknossos/pull/9584)

<https://www.youtube.com/watch?v=luCTbA89g2E>

### Customizable keyboard shortcuts

Keyboard shortcuts are configurable now. They are displayed in a new shortcuts dialog (together with mouse shortcuts which are not editable). [#9081](https://github.com/scalableminds/webknossos/pull/9081)

<https://www.youtube.com/watch?v=cwR6V2LsW_E>

### Other

- The bounding box tab now also lists the dataset layers' bounding boxes as read-only entries at the end of the list (below the editable user bounding boxes). Their name and bounds cannot be edited, but their visibility and color of the rendered outline can be toggled, and they can be navigated to, used to register their segments, and exported. They are shown even when only viewing a dataset (without an annotation). [#9276](https://github.com/scalableminds/webknossos/pull/9276)

  [![Screenshot 2026-08-04 at 12-15-31](https://us1.discourse-cdn.com/flex015/uploads/imagej/optimized/3X/9/7/97c0401cbd14f8001665014f4b94cbe4ef882844_2_690x302.png)](https://us1.discourse-cdn.com/flex015/uploads/imagej/original/3X/9/7/97c0401cbd14f8001665014f4b94cbe4ef882844.png)
- A new blend mode was added (Settings Sidebar > Data Rendering) called "Cover (black as transparent)". The new mode behaves like "Cover", but treats black data as transparent. This behavior is especially helpful for multi-modality datasets. [#9492](https://github.com/scalableminds/webknossos/pull/9492)

  [Read the full changelog](https://github.com/scalableminds/webknossos/releases/tag/23.02.0) : [Releases · scalableminds/webknossos · GitHub](https://github.com/scalableminds/webknossos/releases)
