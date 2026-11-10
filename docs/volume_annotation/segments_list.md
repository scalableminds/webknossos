# Segments List

The right-hand side panel offers a `Segments` tab that lists segments and lets you edit them.
A segment is added to the list as soon as you click it in the data viewport or create it with the volume tools.

With the segments list you can:

- jump to a segment (this uses the position at which the segment was initially registered)
- rename a segment and attach [metadata](#segment-metadata) to it
- toggle the visibility of a segment (the visibility of unlisted segments is controlled with the `Hide unlisted segments` setting in the `Layers` tab of the left sidebar)
- [load 3D meshes](../meshes/loading_meshes.md) for segments (ad-hoc and, if available, precomputed) and download them
- change the color of a segment, and if its mesh is visible, the mesh's opacity using the opacity slider of the color picker
- activate a segment ID so that you can annotate with it
- organize your segments in groups and apply batch actions to whole groups

Watch this short video for an overview of the segments list:
![youtube-video](https://www.youtube.com/embed/3QYBQjL1fls)

## Segment Rows

Each segment is shown as a single row with a visibility checkbox, a dot in the segment's color, and its name.
Unnamed segments are shown as `Segment <ID>`.

- **Click** the name to select the segment and move the viewports to it. ++ctrl++ + click (++cmd++ + click on macOS) selects multiple segments.
- **Double-click** the name to rename it. Press ++enter++ to save or ++escape++ to cancel. Clearing the name resets it to the default.
- **Right-click** the row to open the [segment context menu](#segment-context-menu).

The **active segment**, i.e. the one that the volume tools currently paint with, is marked with a colored bar at the left edge of its row and a bold name.

When you hover over a row, a set of action buttons appears on the right:

- **Mesh**: Loads a mesh for the segment. If a precomputed mesh file is available, a small menu lets you choose between `Load Mesh (precomputed)` and `Compute Mesh (ad-hoc)`. Otherwise, an ad-hoc mesh is computed directly.
- **Center in viewports** (crosshair icon): Moves the viewports to the segment without changing the selection. While the segment is at the center of the viewports, this button stays visible and highlighted, even without hovering.
- **More actions** (`···`): Opens the same menu as a right-click.

Once a mesh exists, the mesh button turns into a permanently visible **mesh chip** that reflects the mesh's state:

| Chip state | Meaning | Click to |
| --- | --- | --- |
| Highlighted | The mesh is visible. | Hide the mesh. |
| Outlined | The mesh is loaded but hidden. | Show the mesh. |
| Spinner (yellow) | The mesh is still being computed. | Cancel the computation. |

Hover over the chip to see whether the mesh is precomputed or ad-hoc.

### Segment Context Menu

Right-click a segment (or use its `···` button) to open its context menu.
The menu header shows the segment's ID.

| Action | Description |
| --- | --- |
| `Rename Segment` | Turns the name into an input field, just like double-clicking it. |
| `Activate Segment ID` | Makes this segment the active one, so that the volume tools paint with its ID. Disabled if it is already active. |
| `Change Segment Color` | Opens a color picker. If the segment's mesh is visible, the picker also has an opacity slider for the mesh. |
| `Reset Segment Color` | Reverts a custom color to the color from the segmentation's color map. Disabled if no custom color is set. |
| `Remove Segment From List` | Removes the segment from the list. The segmentation data is not changed. |
| `Delete Segment's Data` | Sets all voxels of this segment to 0 after a confirmation. Afterwards, a notification offers to also remove the segment from the list. This requires a volume annotation layer with a segment index and is not yet supported for volume layers that are based on an existing segmentation (fallback layer). |
| `Show Segment Statistics` | Opens the [segment statistics](./segments_statistics.md) for this segment. Only shown if a segment index or segment statistics file is available. |
| `Load Mesh (precomputed)` | Loads the mesh from the precomputed mesh file selected in the mesh settings. Disabled if there is no mesh file. A warning icon indicates that the segmentation was edited since the mesh file was created, so the mesh may be outdated. |
| `Compute Mesh (ad-hoc)` | Computes a mesh for this segment on the fly. |
| `Show Meshes` / `Hide Meshes`, `Refresh Meshes`, `Remove Meshes`, `Download Meshes` | Manage an already loaded mesh. Only shown if the segment has a mesh. |

If you right-click a segment that is part of a multi-selection, the menu applies to all selected segments instead.
It offers `Load Meshes (precomputed)`, `Compute Meshes (ad-hoc)`, the mesh management actions, `Change Segment Color`, `Reset Segment Colors`, `Remove Segments From List`, and `Show Segment Statistics`.

## Segment Groups

Segments can be organized into groups and nested subgroups to label related segments and apply batch actions to all of them at once.
Each group row shows the number of segments it contains, including those of its subgroups.
All segments that are not in a group belong to the top-level `Root` group.

There are two ways to create a group:

- To create a new top-level group, click the `Create new Group` button (the folder icon with a plus) at the top of the `Segments` tab.
- To create a subgroup, right-click an existing group and select `Create new group` from the context menu. The new group is created inside the group you clicked.

Drag and drop segments onto a group to move them there. If the dragged segment is part of a multi-selection, all selected segments are moved.
Groups can be dragged into other groups as well.
To rename a group, double-click its name or use `Rename group` from its context menu.
Toggling the checkbox of a group shows or hides all of its segments.

### Group Context Menu

Right-click a group to open its context menu.
The batch actions apply to all segments of the group and its subgroups.

| Action | Description |
| --- | --- |
| `Create new group` | Creates a subgroup inside this group. |
| `Rename group` | Turns the group name into an input field. Not available for the `Root` group. |
| `Delete group` | Asks whether to `Remove group including all children` or to `Remove group and keep children`. In the latter case, the group's segments and subgroups are moved up one level. |
| `Expand all subgroups` / `Collapse all subgroups` | Expands or collapses the whole group hierarchy below this group. Only shown when it would change something. |
| `Move active segments here` | Moves the currently selected segments into this group. |
| `Change Segment Color` | Assigns one color to all segments of the group. |
| `Reset Segment Colors` | Reverts all segments of the group to the colors of the segmentation's color map. |
| `Show Segment Statistics` | Opens the [segment statistics](./segments_statistics.md) for all segments of the group. Only shown if a segment index or segment statistics file is available. |
| `Load Meshes (precomputed)` | Loads the meshes of all segments from the selected precomputed mesh file. Disabled if there is no mesh file. |
| `Compute Meshes (ad-hoc)` | Computes ad-hoc meshes for all segments of the group. |
| `Show Meshes` / `Hide Meshes`, `Refresh Meshes`, `Remove Meshes`, `Download Meshes` | Manage the loaded meshes of the group's segments. Only shown if at least one segment of the group has a mesh. |

## Toolbar

The toolbar at the top of the `Segments` tab contains these buttons:

- **Search** (magnifier icon, or ++ctrl+shift+f++ while the tab is open): Searches segment and group names. Press ++enter++ / ++shift+enter++ to jump to the next / previous match. The `Select all matches (except groups)` button selects all matching segments at once, e.g. to apply a batch action to them via the context menu.
- **Create new Group** (folder icon with a plus): Creates a new top-level group.
- **Add a precomputed mesh file** (plus icon): Starts a job that [precomputes meshes](../meshes/loading_meshes.md#precomputed-meshes) for all segments of the dataset.
- **Configure mesh computation** (gear icon): Selects the precomputed mesh file to load meshes from and the quality used for ad-hoc mesh computation.

## Details Panel

Below the list, a details panel shows information about the current selection.
Drag the divider above it to resize it.

- If **one segment** is selected, the panel shows its ID, its name, and its [metadata](#segment-metadata).
- If **a group** is selected, the panel shows its ID, its name, and the number of segments it contains. For groups with subgroups, both the number of direct children and the total number including all subgroups are shown.

The name can be edited directly in the panel, too.

## Segment Metadata

You can attach your own key-value properties to a segment, for example to record a cell type, a review status, or a confidence score.
Select a single segment to edit its metadata in the [details panel](#details-panel):

1. Click the `+` button below the name (`Add a new metadata property`) and choose the type of the value:
    - `Text`: a single string
    - `Number`: a numeric value
    - `Multi-Item Text`: a list of strings, entered as tags. Tags that are already used in other properties of the same segment are suggested.
2. Enter the property name in the `Property` field. Each key can only be used once per segment.
3. Enter the value.

To remove a property, click the `×` button at the end of its row.
Changes are saved with the annotation and can be undone like other annotation changes.
Metadata cannot be edited in read-only annotations.

Segment metadata is included when you [download the annotation as NML](./import_export.md).
See the [NML format description](../data/concepts.md#metadata-entries) for how the entries are stored.
Trees support the same kind of metadata, see the [Skeleton tree list](../skeleton_annotation/trees_list.md#tree-metadata).
