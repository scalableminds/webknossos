# Tree Operations & Tree Groups

TODO: remove classic controls from docs

All operations and information regarding trees are organized under a tab called `Trees` on the right-hand side of the screen.

A typical skeleton annotation consists of one or more trees.
Trees can be nested and organized in so-called `Tree Groups`.
Tree groups can have a name and are used to structure and label your annotation even further.
Trees can be dragged and dropped between tree groups.
This action can be applied to multiple trees by selecting them with Ctrl + Left Mouse (on Mac OS Cmd + Left Mouse).
Right-click on an existing tree group to bring up a menu for creating new (sub-)groups or to delete a group.
Renaming of a group can be done by selecting a group and then entering a new name into the input above the tree hierarchy structure view.

![Organize your skeleton annotation's trees to remember important structures for later reference](images/tracing_ui_trees.jpeg)

## Merging / Splitting Trees

Common tree operations include splitting and merging trees.

- `Tree splitting` can be done in two ways:

  1. Delete the node at which to split. This can be done by right-clicking a node and choosing "Delete this Node". If you have enabled _Classic Controls_, you need to select (_SHIFT + Left Click_) the node first and then delete (_DEL_) it.
  2. Delete an edge between two nodes. Select the first node (_Left Click_), then right-click the second node and select _Delete Edge to this Node_. If you have enabled _Classic Controls_, you need to select the first node with _Shift + Left Click_ and then click on the second node with _SHIFT + CTRL + Left Click_ on the second node of the edge to delete this connection.

- `Tree merging` works similarly to edge deletion but will create a new edge between two previously unconnected trees. Select the first node and right-click on a second one to choose _Create Edge & Merge with this Tree_. When using _Classic Controls_, the second node needs to be selected with _SHIFT + ALT + Left Click_ to create an edge between the two.

![Trees can split by deleting the edge between two nodes or deleting a node. Two trees can be merged again by creating a new edge between them.](images/tracing_ui_tree_merge_split.gif)

## Tree Colors

A random color is assigned to each tree upon creation.
Colors can be shuffled for a single tree or for all trees in a skeleton.
Right-click on a tree to bring up several actions, e.g. `Shuffle Color`.
When editing several trees, use the overflow menu under `More` in the `Skeleton` tab and select `Change Color` or `Shuffle All Colors` to assign new randomly chosen colors.
All nodes have the same color as their parent tree and can not be changed individually.
The active node, branch points, and nodes that have comments assigned to them are highlighted with a slight variation of the tree's color.

![Trees are randomly assigned colors upon creation.
Users can assign new random colors to a single tree or all trees at once.](images/tracing_ui_tree_color.jpeg)

## Skeleton & Tree Visibility

You can quickly toggle the visibility of all skeletons from the `Layers` menu in the left-hand side panel.

The visibility of individual trees can be toggled to hide some trees for a better overview.
Toggle the checkbox before each tree name or tree group to hide/show it.
Alternatively, the visibility of all trees can be toggled all at once using the `Toggle Visibility of All Trees` / `Toggle Visibility of Inactive Trees` button under the `Skeleton` Tab.
There are also keyboard shortcuts to quickly toggle the visibility:

| Key Binding | Operation                           |
| ----------- | ----------------------------------- |
| 1           | Toggle Visibility of all Trees      |
| 2           | Toggle Visibility of Inactive Trees |

![Trees can be hidden for a better overview of the data. Toggle the visibility of an individual tree using the checkbox in front of the tree's name or use the button to toggle all (inactive) trees at once.](images/tracing_ui_tree_visibility.jpeg)

## The Context Menu for Easy Access to Functionalities

WEBKNOSSOS has a context menu that can be opened via _Right Click_ (or _Shift + Right Click_ if _Classic Controls_ are enabled). This context menu offers useful context-sensitive information and most operations should be available through it:

![Example of the context menu](./images/context_menu.jpeg)

Example operations include (but are not limited to):

- Clicking on a node:
  - measuring the path length of the active node to the selected node
  - node deletion
  - tree merging & splitting
  - and many more
- Clicking on a volume segmentation:
  - compute or load its 3D mesh
  - flood-filling the segment (assigning a new ID)
- Clicking on the background data:
  - Creating a new node or tree
  - Creating a new bounding box
