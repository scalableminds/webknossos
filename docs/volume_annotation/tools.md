# Volume Annotation Tools

Volume annotation in WEBKNOSSOS allows you to label and segment 3D structures in your dataset. This page covers the available tools and best practices for efficient volume annotation.


![Trace Tool](../ui/images/trace-tool.jpg){align=left width="60"}
**Trace Tool**: Create precise boundary definitions by drawing outlines around structures. This tool is particularly useful when accuracy is crucial. For added precision consider using a [pen input device](./pen_tablets.md). 
![Adding labels with the Trace tool](../images/volume_trace.gif)

![Brush Tool](../ui/images/brush-tool.jpg){align=left width="60"} 
**Brush Tool**: Paint directly onto the dataset to mark regions of interest. The brush size is adjustable using ++shift++ + _Mousewheel_. Drawing around objects in one continuous motion will automatically fill the inside area.
![Adding labels with the Brush tool](../images/volume_brush.gif)

![Eraser (Trace/Brush)](../ui/images/eraser-tool.jpg){align=left width="60"} 
 **Eraser (Trace/Brush)**: Remove existing labels by drawing over them. Functions identically to the Trace/Brush tools, with adjustable size using ++shift++ + _Mousewheel_.
![Removing labels with the Eraser tool](../images/volume_delete.gif)

![Fill Tool](../ui/images/fill-tool.jpg){align=left width="60"} 
**Fill Tool**: Fill regions with volume annotations up to segment boundaries or viewport edges. Useful for:

- Filling holes in segments
- Relabeling segments with different IDs/colors
- Quick corrections of small areas
- The fill behavior can be modified using the 2D/3D fill modifiers (see below).

![Segment Picker Tool](../ui/images/segment-picker-tool.jpg){align=left width="60"} 
**Segment Picker**: Click any segment to use its label ID as the active segment ID and keep annotating with that ID. This is alternative to selecting the segment ID from the [Segments list](./segments_list.md) sidebar or context menu.

![Quick Select Tool](../ui/images/quickselect-tool.jpg){align=left width="60"} 
**Quick Select**: Automatically annotate segments using either:

  - Threshold-based selection mode
  - AI-based segmentation (powered by Segment Anything Model 2)
    The AI mode works across various imaging modalities and can significantly speed up annotation workflows. See the [Quick-select tool](#quick-select-tool) section for detailed usage.

![Proof Reading Tool](../ui/images/proofreading-tool.jpg){align=left width="60"} 
**Proof Reading**: Fix merge and split errors in automated segmentations using the underlying super-voxel graph by combining and breaking apart segments. Read more about [proofreading](../proofreading/tools.md).


In the [Segments tab](./segments_list.md) on the right-hand side panel, you can find all segment IDs which are available in your annotation. You can rename and organize segments as needed.

The active segment ID under the cursor can be found in the [status bar](../ui/status_bar.md) at the bottom of the screen or through the context menu when right-clicking.

!!! tip "Keyboard Shortcuts"
    For faster workflows, refer to the [keyboard shortcuts](../ui/keyboard_shortcuts.md) guide.


### Tool Modifiers
The following interactions and modifiers become available when working with some of the volume annotation tools. They can be found in the toolbar:

![Create New Segment ID Modifier](./images/new-segment-modifier.jpg){align=left width="60"} 
**Create New Segment ID**: Creates a new segment ID for labeling with a different color and identifier. New segments will be added to the [segments list](./segments_list.md) in the right sidebar automatically.

![Change Brush Size Modifier](./images/brush-size-modifier.jpg){align=left width="60"} 
**Change Brush Size**: Changes the size and radius of the brushing tool. Presets of small, medium and large brush sizes are available which can be modified to suit your workflows. ![youtube-video](https://www.youtube.com/embed/JkpSTKuNZKg)

![Overwrite Everything Modifier](./images/overwrite-everything-modifier.jpg){align=left width="60"} 
**Overwrite Everything**: When labeling with the brush/trace tool, you can annotate every available voxel without any regard if it was already labeled as a different segment or whether it is unlabelled. This allows you to draw over existing segments.

![Overwrite Empty Voxels Modifier](./images/overwrite-empty-modifier.jpg){align=left width="60"} 
**Only Overwrite Empty Areas**: In contrast to the `Overwrite Everything` modifier, the forces the brush & trace tools to only label voxels without any segment ID ("empty areas"). This is useful when annotating segments that directly touch each other to avoid accidental overwrites.

![Interpolation/Extrusion Modifier](./images/interpolation-modifier.jpg){align=left width="60"} 
**Interpolation/Extrusion**: Annotate a segment, skip a few sections in the Z direction, and annotate it again. Now, you can interpolate between the two segments. Read more on the [interpolation/extrusion](#volume-interpolation) below. 

![2D Fill Modifier](./images/2d-modifier.jpg){align=left width="60"} 
![3D Fill Modifier](./images/3d-modifier.jpg){align=left width="60"} 
**2D/3D Fill**: Modifies the flood filling tool to work in 2D (in-plane only) or 3D (volumetric fill/re-labeling). 3D flood fill is constrained to a small, regional bounding box for performance reasons. Read more about [flood fills](#volume-flood-fills) below.


## Quick-select tool
The Quick Select tool offers AI-powered automatic segmentation, powered by [Segment Anything Model 2](https://ai.meta.com/blog/segment-anything-2/). Simply draw a selection around your target structure, and WEBKNOSSOS will automatically segment it for you.

### Operating Modes

**AI Mode** (Default)

- Activate the "AI" button in the toolbar
- Works across various imaging modalities
- Segments structures based on machine learning

**Threshold Mode**

- Disable the "AI" button
- Uses intensity-based segmentation
- Fills from the center of your selection

### Usage Steps

1. Select the Quick Select tool from the toolbar
2. Choose your preferred mode (AI or threshold)
3. Click the settings icon to configure:
    - Number of sections to process
    - Preview mode for real-time parameter adjustment
4. Draw a rectangle around your target structure or click on it directly
5. WEBKNOSSOS will automatically segment the structure across your specified sections

![youtube-video](https://www.youtube.com/embed/FnIor77Dg8s)

## Volume Interpolation

The Volume Interpolation feature accelerates your annotation workflow by automatically filling in intermediate slices:

1. Label your structure in one slice (e.g., at z=10)
2. Skip several slices and label the structure again (e.g., at z=14)
3. Press the "Interpolate" button or use shortcut ++v++ to automatically generate labels for the slices in between

!!! tip
    When working with [tasks](../tasks_projects/tasks.md), this feature needs to be explicitly enabled by the task creator.

!!! warning
    Always review the interpolated slices, as the automated results are based on heuristics and may require adjustments.

## Volume Extrusion

Volume Extrusion is an alternative to interpolation that preserves the exact shape of your annotation across multiple slices:

1. Label your structure in one slice (e.g., at z=10)
2. Move to a target slice (e.g., z=12)
3. Click the "Extrude" button in the toolbar to copy your annotation to all slices in between

!!! note "Extrusion vs. Interpolation"
    Unlike interpolation, extrusion maintains the exact shape of your source annotation. The structure is copied without any shape adaptation between slices.

You can find the extrude button in the toolbar or use the dropdown menu next to the interpolation/extrusion button.

![youtube-video](https://www.youtube.com/embed/GucpEA6Wev8)

## Volume Flood Fills

WEBKNOSSOS supports volumetric flood fills (3D) to relabel a segment with a new ID. Instead of having to relabel segment slice-by-slice, WEBKNOSSOS can do this for you. This operation allows you to fix both split and merge errors:

- For split errors: Combine two segments by relabeling one segment with the ID of the other. Since this operation is fairly compute-intensive you might be better of with the [Merger Mode](../proofreading/merger_mode.md).
- For merge errors: You have to manually split two segments at their intersection/border, e.g. a cell boundary. Use the eraser brush and make sure to establish a clear cut between both segments on a slice-by-slice basis. Both segments must not touch any longer. Create a new segment ID from the toolbar and apply it to one of the partial segments that you just divided.

!!! note "Performance Consideration"
    For performance reasons, 3D flood-fills only work in a small, local bounding box. For large-scale modifications, consider using the [proofreading tool](../proofreading/tools.md) instead of 3D flood-fills, as it's optimized for handling larger volumes.
