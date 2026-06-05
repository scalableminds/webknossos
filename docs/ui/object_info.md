# Object Info and Lists

The right-hand side panel provides detailed information and controls for your annotations. It contains several tabs, each focusing on a different aspect of your data.

## Info Tab

The `Info` tab displays metadata about the current annotation and dataset. This includes:

- **Annotation Name and Description:** You can edit the name and description of your annotation here.
- **Dataset Information:** Details about the dataset, such as its name, owner, and contributors.
- **Dimensions:** The voxel size and extent of the dataset.
- **Statistics:** A summary of the annotation data, such as the number of skeletons and segments.

## Skeleton Tab

The `Skeleton` tab is used for managing skeleton annotations. It lists all the trees in the annotation and allows you to perform various actions on them, such as:

- **Searching and Filtering:** Find specific trees or nodes.
- **Adding and Deleting:** Create new trees or remove existing ones.
- **Grouping:** Organize trees into groups.

[Read more about skeleton annotations.](../skeleton_annotation/tools.md)

## Comments Tab

The `Comments` tab displays a list of all comments attached to the nodes of a skeleton annotation. You can use this tab to:

- **View and Navigate:** See all comments and jump to the corresponding node in the viewport.
- **Add and Edit:** Add new comments or modify existing ones.

[Read more about comments and skeleton annotations.](../skeleton_annotation/comments.md)

## Segments Tab

The `Segments` tab is for managing volume annotations. It lists all the segments in the annotation and provides tools for:

- **Mesh Generation:** Create 3D meshes for individual segments or the entire annotation.
- **Visualization:** View and inspect the generated meshes.
- **Downloads:** Download segment data and meshes.

[Read more about 3D meshes.](../meshes/loading_meshes.md)

## Bounding Boxes Tab

The `BBoxes` tab lists all the bounding boxes in the annotation. From here, you can:

- **Create and Delete:** Add new bounding boxes or remove existing ones.
- **Generate:** Use the grid icon button to automatically place a set of bounding boxes at random positions across the dataset. This is useful when preparing ground truth data for [AI model training](../automation/ai_training.md). You can configure the number of boxes and their size, and generated boxes are guaranteed not to overlap each other.
- **Navigate:** Jump to a specific bounding box in the viewport.
- **Rename:** Change the name of a bounding box.

This tab provides an alternative to using the `Bounding Box` tool from the toolbar.

### Maximum Intensity Projection (MIP)

Each bounding box can be rendered as a **Maximum Intensity Projection (MIP)** in the 3D viewport. A MIP casts rays through the volume and displays the highest intensity value encountered along each ray, producing a useful projection for structures (especially useful for light-microscopy datasets).

To enable MIP for a bounding box, right-click it and choose **Render as MIP**, then select a layer and magnification. Multiple layers can be active on the same bounding box at once; their projections are blended additively using each layer's configured color and opacity.

Once loaded, the MIP rendering appears in the 3D viewport. Shift-clicking on a MIP projection navigates to the maximum-intensity voxel along the click ray.

Use the MIP icon button in the tab toolbar to open the **Maximum Intensity Projection (MIP) Settings** popover, which provides the following controls:

- **Ray marching steps:** Controls the number of samples taken along each ray. Higher values produce a smoother, more accurate projection at the cost of GPU performance.
- **Depth-correct rendering:** When enabled, MIP volumes interact correctly with mesh depth — meshes can occlude or be occluded by the MIP content. Disable this for better performance if depth sorting with meshes is not needed.

## Abstract Tree Tab

The `AbsTree` tab displays a 2D representation of a skeleton annotation. This can be useful for visualizing the structure of large and complex skeletons. Be aware that generating the abstract tree can be resource-intensive for very large skeletons.

## Connectome Tab

The `Connectome` tab is used for visualizing and interacting with connectome data. If a connectome file is available for the segmentation layer, you can use this tab to:

- **Explore Connections:** Analyze the connections between segments.
- **Filter and Search:** Find specific connections or segments.

[Read more about the connectome viewer.](../connectome_viewer.md)

## Customizing the Layout

You can customize the layout of the right-hand side panel to fit your workflow. You can reorder the tabs via drag-and-drop or hide or move them to a different position, e.g. showing two tabs at a time.
