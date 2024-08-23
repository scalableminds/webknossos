# Volume Annotation Tools

Choose a drawing tool from the toolbar or press _W_ to switch between them.

- `Move`: Navigate around the dataset.
- `Trace`: Draw an outline around the voxel you want to label.
- `Brush`: Paint over the voxels you would like to label. Use _SHIFT + Mousewheel_ to change the brush size.
- `Erase (Trace/Brush)`: Erase voxels by drawing over them. Use _SHIFT + Mousewheel_ to change the brush size.
- `Fill Tool`: Fill the clicked region with a volume annotation up to the next segment boundary (or the edge of your viewport). All neighboring voxels with the same voxel id as the clicked voxel will be labelled with the active segment ID. This is useful for filling a hole in a segment or relabeling a segment with a different ID/color.
- `Segment Picker`: Click a segment to use its label ID as the active segment ID and keep annotating with that ID.
- `Quick Select`: Annotate a segment automatically by drawing a rectangular selection over it. The tool operates in two different modes. 
When the "AI" button in the toolbar is activated, a machine-learning model is used to infer the selection. When the AI button is disabled, the tool operates on the intensity data of the visible color layer and automatically fills out the segment starting from the center of the rectangle. Next to the tool, there is a settings button which allows to enable a preview mode and to tweak some other parameters. When the preview is enabled, you can fine-tuned the parameters and see the preview update instantly.
- `Proof Reading`: Fix merge and split errors in automated segmentation. Read more about [proofreading](./proof_reading.md#proofreading-tool).

When using the trace or brush tool, a label can be added with _Left Mouse Drag_.
Erasing is possible with the dedicated erase tools or with _CTRL + Shift + Left Mouse Drag_.

If you have enabled _Classic Controls_ in the settings sidebar, erasing is also possible with _Right Mouse Drag_ within the brush and trace tool (otherwise, right-clicking is mapped to open a context menu).

The following interactions and modifiers are available when working with the volume annotation tools:

- `Create New Segment ID`: Creates a new segment ID for labeling. Note the little color indicator in the top right corner of the button visualizing the current color of the active segment ID. Read the explanation for the largest segment id [here](datasets.md#configuring-datasets) to understand how new IDs are generated.
- `Change Brush Size`: Changes the size of the brushing tool.
- `Overwrite Everything`: When labeling with the brush/trace tool, you can annotate every available voxel without any regard if it was already labeled as a different segment or whether it is unlabelled. This allows you to draw over existing segments.
- `Only Overwrite Empty Areas`: In contrast to the `Overwrite Everything` modifier, the forces the brush & trace tools to only label voxels without any segment ID ("empty areas"). This is useful when annotating segments that directly touch each other to avoid accidental overwrites.
- `2D Fill`/ `3D Fill`: Modifies the flood filling tool to work in 2D (in-plane only) or 3D (volumetric fill/re-labeling). 3D flood fill is constrained to a small, regional bounding box for performance reasons. Read more about flood fills below.

![Adding labels with the Trace tool](./images/volume_trace.gif)
![Adding labels with the Brush tool](./images/volume_brush.gif)
![Removing labels with the Brush tool](./images/volume_delete.gif)

In the `Segmentation` tab on the right-hand side panel, you can see the segment IDs which are available in your annotation. You can rename segments as needed.

The active segment ID under the cursor can be found in the status bar at the bottom of the screen or through the context-sensitive menu on right-click.