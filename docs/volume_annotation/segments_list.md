# Segments List

The right-hand side panel offers a `Segments` tab that lists segments and allows to edit these.
A segment is added to the list as soon as it was clicked in the data viewport.
The following functionality is available for each segment:

- jumping to the segment (via left-click; this uses the position at which the segment was initially registered)
- naming the segment
- toggling the visibility of the segment (the visibility of unlisted segments is controlled with the `Hide unlisted segments` setting in the left sidebar in the `Layers` tab)
- [loading 3D meshes](../meshes/loading_meshes.md) for the segments (ad-hoc and precomputed if available)
- download of 3D meshes
- changing the color of the segment, and if its mesh is visible, changing the mesh's opacity using the opacity slider of the segment color picker
- activating the segment id (so that you can annotate with that id)
- organizing your segments in groups

![youtube-video](https://www.youtube.com/embed/BJ7lblTSVKY)

Working with groups allows you to perform batch actions on a whole group of segments (e.g. changing the color, loading meshes, ...)
![youtube-video](https://www.youtube.com/embed/lz-3kFWQ2H8)

## Segment Groups

Segments can be organized into groups and nested subgroups to label related segments and apply batch actions to all of them at once. There are two ways to create a group:

- To create a new top-level group, click the `Create new Group` button (the folder icon with a plus) at the top of the `Segments` tab.
- To create a subgroup, right-click an existing group and select `Create new group` from the context menu. The new group is created inside the group you clicked.

Drag and drop segments onto a group to organize them. Right-click a group to delete it or to run batch actions (such as changing the color or loading meshes) on all of its segments at once.