# Tracing View UI

## Overview
The main webKnossos user interface for viewing and annotating datasets is divided into four sections.

1. A toolbar for general purposes features such as Saving your work and displaying the current position within the dataset. It spans along the full width of the top of your screen. [Read more below](#the-toolbar).
2. On the left-hand side, a settings menu gives you control of several parameters of webKosssos. For instance, you can fine-tune a dataset's contrast & segmentation opacity, as well as adjust movement speed of the mouse and keyboard. [Read more below](#tracing-ui-settings).
3. The center of the screen is occupied by the tracing interface. Your dataset is displayed here and users can add annotations or add/edit the segmentation. Most interactions will take place here. [Read more below](#skeleton-annotations).
4. The right-hand side of the screen is occupied by several tabs providing more information on your current dataset or tracing. Depending on your editing mode these tabs might adapt.

![An overview of the webKnossos tracing UI highlighting the 4 main sections of the interface](images/tracing_ui_overview.png)

## The Toolbar
The toolbar contains frequently used commands, your current position within the dataset and the ability to switch between various modes for viewing and interaction with the dataset or tools depending on your tracing mode.

The most common buttons are:
- `Settings`: Toggles the visibility of the setting menu on the left-hand side to provide more space for your data.
- `Undo` / `Redo`: Undoes the last operation or redoes it if now changes have been made in the meantime.
- `Save`: Saves your annotation work. wK automatically saves every 30 seconds.
- `Archive`: Only available for explorative tracings. Closes the tracing and archives it, removing it from a user's dashboard. Archived tracings can be found on a user's dashboard under "Explorative Tracings" and by clicking on "Show Archived Annotations". Use this to declutter your dashboard. 
- `Download`: Starts the download of the current annotation. Skeleton annotations are downloaded as [NML](./data_formats.md#nml) files. Volume annotation downloads contain the raw segmentation data as [wkw](./data_formats.md#wkw) files.
- `Share`: Create a shareable link to your dataset containing the current position, rotation, zoom level etc. Use this to collaboratively work with colleagues. Read more about this feature in the [Sharing guide](./sharing.md).  
- `Add Script`: Using the [wK frontend API](https://demo.webknossos.org/assets/docs/frontend-api/index.html) users can interact with wK programmatically. User scripts can be executed from here. Admins can add often used scripts to wK to make them available to all users for easy access.

A user can directly jump to positions within their datasets by entering them in the position input field. The same is true for the rotation in some tracing modes. Clicking on the position or rotation labels copies the values to the clipboard.

![The webKnosos toolbar contains many useful features for quick access such as Saving und Undo/Redo](images/tracing_ui_toolbar.png)

## Skeleton Annotations
The goal of tracing skeletons is to reconstruct structures in a dataset that span across many data slices as a graph of connected nodes. A typical example of a skeleton annotation is to follow a nerve cell for a few nanometers, placing a node every few slices. (See image below)

A typical skeleton tracing contains the reconstruction of one or more structures, often with many thousand nodes. All connected nodes form a tree or more generally speaking a graph.

Skeleton tracings can be downloaded, modified, imported using a human-readable XML-based file format called [NML](./data_formats.md#nml).

This article outlines commonly used features and operations for viewing, editing, or creating new skeleton annotations in webKnossos.

![An example of a complex webKnossos skeleton annotation](images/tracing_ui_skeletontracing.jpg)

### Tracing Modes
webKnossos supports several modes for displaying your dataset & interacting with skeleton tracings.

#### Orthogonal Mode
Orthogonal mode displays a dataset with the camera oriented orthogonally to each of the three main axis x, y, z. Additionally, a fourth viewport shows the data and skeletons from a 3D perspective. All camera movements happen along the respective main axis. This view is especially useful for viewing your data in the highest possible quality alongside its main imaging axis, typically XY. Every single slice of the raw data can be viewed.

Most skeleton tracing operations and keyboard shortcuts are tailored for the Orthogonal Mode.

![Switch between different tracing modes using the buttons in the toolbar](images/tracing_ui_modes.png)

#### Flight Mode
Flight mode allows an arbitrary view through the data. In contrast to orthogonal mode, any arbitrary slice through the dataset at any rotational angle of the camera is possible. In Flight mode, the data is projected on the inside of a sphere with the camera located at the center of the sphere. 

Spherical projection is especially useful when rotating the camera, as pixels close to the center of the screen move in a predictable manner. Interaction and movements in flight mode feel similar to First-Person (FPV) games.

Flight mode is best used for annotating structures very quickly. Skilled tracers can follow "tube"-like structure as though they are "flying" through them. Nodes are placed automatically along the flight path, creating skeleton very efficiently.

TODO add image

#### Oblique Mode
Oblique Mode is similar to Flight mode, but arbitrary cuts through the data are not projected on a sphere but are straight instead.


### Nodes and Trees
Skeleton tracings consist of connected nodes forming a graph. Nodes are connected through edges and are organized a trees. 

Nodes can be placed by right clicking in orthogonal mode or automatically when moving in flight or oblique mode. webKnossos uses the concept of always having an active node and an active tree. All (global) operations are executed on the current active node, e.g. adding a comment or node deletion. Most keyboard shortcuts take the active node into context. Operations on whole trees, e.g. splitting or merging trees, follow the same pattern.

Skeleton tracing can contain one or many trees consiting of several nodes all the way to millions of nodes. Users can add comments to each node to mark important positions or easily select them from a list of comments for later usage. Comments are organized in the `Comments` tab on the right-hand side of the screen. The `Tree Viewer` tab on the right-hand side menu displays a 2D simplified tree representation of the currently active tree.

Many organic structures do not follow a single, linear path but split into several individual branches instead. webKnossos natively supports branch points. Any node can be marked as a branch point using the keyboard shortcut "B". Branch points are highlighted using a slightly different color. All branch points are saved as a stack for each tree and can be accessed first-in, first-out (FIFO). Press the "J" to jump to the latest branch point to continue working from their and remove it from the stack.

| Key Binding       | Operation                           |
| ----------------- | -------------                       |
| Right Click       | Create New Node                     |
| SHIFT + Left Click| Select Node (Mark as Active Node)   |
| S                 | Center Camera on Active Node        |
| DEL               | Delete Active Node                  |
| B                 | Create Branch Point                 |
| J                 | Jump to Last Branch Point           |

All further keyboard shortcuts are [available here](./keyboard_shortcuts.md). 

### Tree Operations & Tree Groups
All operations and information regarding trees are organized under a tab called `Trees` on the right-hand side of the screen.

A typical skeleton tracing consists of one or more trees. Trees can be nested and organized in so-called `Tree Groups`. Tree groups can have a name and are used to structure and label your annotation even further. Trees can be dragged and dropped between tree groups. However over existing tree groups the bring up a little menu for creating new groups, renaming, and deletion.

![Organize your skeleton tracing's trees to remember important structures for later reference](images/tracing_ui_trees.jpg)

#### Merging / Splitting Trees
Common tree operations include splitting and merging trees. 

- `Tree splitting` can be done in two ways: 
  1. Select a node at which to split (SHIFT + Left Click) and delete (DEL) it.
  2. Delete an edge between two nodes. Select the first node (SHIFT + Left Click), then SHIFT + CTRL + Left Click on the second node of the edge to delete this connection.
- `Tree merging` works similarly to edge deletion but will create a new edge between two previously unconnected trees. Select the first node and SHIFT + ALT + Left Click the second node to create an edge between the two.

![Trees can split by deleting the edge between two node or deleting a node. Two trees can be merge again by creating a new edge between them.](images/tracing_ui_tree_merge_split.gif)

#### Tree Colors
A random color is assigned to each tree upon creation. Colors can be shuffled for a single tree or for all trees in a skeleton. Use the overflow menu under `More in the tree tab and select `Change Color` or `Shuffle All Colors` to assign new randomly chosen colors. 
All node have the same color as their parent tree and can not be changed individually. The active node, branch points, and node that have comments assigned to them are highlighted with a slight variation of the tree's color.

![Trees are randomly assigned colors upon creation. Users can assign new random colors to a single tree or all trees at once.](images/tracing_ui_tree_color.png)

#### Tree Visibility
The visibility of individual trees can be toggled to hide some trees for a better overview. Toggle the checkbox before each tree name or tree group to hide/show it. Alternatively, the visibility of all trees can be toggled all at once using the `Toggle All` / `Toggle Inactive` button under the `Tree Tab`.  There are also keyboard shortcuts to quickly toggle the visibility:

| Key Binding                 | Operation                             |
| ----------------------------| -------------                         |
| 1                           | Toggle Visibility of all Trees        |
| 2                           | Toggle Visibility of Inactive Trees   |
| SHIFT + ALT + Left Click    | Merge Two Nodes and Combine Trees     |
| SHIFT + CTRL + Left Click   | Delete Edge / Split Trees             |

![Trees can be hidden for a better overview over the data. Toggle the visibility of individual tree using the checkbox in front of the tree's name or use the button to toggle all (inactive) trees at once.](images/tracing_ui_tree_visibility.png)


### Importing & Exporting NML Files
webKnossos makes it easy to import or export skeleton tracings as [NML files](./data_formats.md#nml). There are two ways for downloading your tracings:

1. There is a `Download` button in the overflow menu next to the prominent `Save` button in the toolbar at the top of the screen. 

2. If you need more fine-grained control over which trees to download use the `Download Selected Trees` option. From the `Trees Tab` click on `More` and select `Download Selected Trees` from the menu. All visible trees (checkmark in front of the name) will be downloaded as an NML file. This is especially useful if you need to only download a single tree of an otherwise much larger tracing.

![Skeletons can be exported and downloaded as NML files from the tracing view. Either download all or only selected trees. ](images/tracing_ui_download.png)

Importing a skeleton tracing can be achieved using two approaches as well:

1. If you already have a tracing open you can easily add more skeletons to it by drag and dropping an NML file onto your browser window. Otherwise, use the `Import NML` option next to `Download Selected Trees`. This will merge the NML file's content with the already open tracing. 

2. To import a skeleton tracing as a completely new wK annotation, just drag and drop the NML file anywhere on your user dashboard. Alternately, navigate to your user dashboard and use the `Upload Annotation` button within the "Explorative Tracings" section. 

![Skeletons can be imported by drag and drop in the tracing view or from the dashboard](images/tracing_ui_import.png)

### Merging Skeleton Annotation
There are two ways for merging tracings:

1. While in the tracing UI, drag and drop an NML file onto your browser window to import a skeleton. The imported skeleton will be merged with currently open tracing.

2. If you would like to merge your current tracing with another existing tracing, select the `Merge` operation from the overflow menu next to the `Save` button. (see image) Either enter the ID of an existing explorative tracing or select a whole project and proceed to merge the selection with your currently open tracing. The resulting annotation can either be created as a new explorative tracing. Otherwise, the merge will happen in your current tracing. 

![1. Select the Merge operation from the menu](images/tracing_ui_merge_1.png)
![2. Merging can be done with a whole wK project or using the ID of an existing explorative tracing](images/tracing_ui_merge_2.png)


## Volume Annotations
- what are volume tracings
- tools
  - brush, move, selection
- adding / deleting segmentation
- keyboard shortcuts
- segementation tab


## Tracing UI Settings
The settings menu allows users to fine-tune some parameters of webKnossos. All settings are automatically saved as part of a user's profile. 
The `Tracing` settings include options related to interacting with a dataset while annotating, e.g. mouse movement speed. Tracing settings only affect the currently open annotation and will be restored when reopening the respectibe annotation in the future.
The `Dataset` settings include options to adjust the rendering of the dataset, e.g. brightness & contrast. Dataset settings effect all of the user's annotations referencing this particular dataset so that tracing can be created using the same conditions.

Not all settings are available in every tracing mode.

### Tracing Settings
Controls
- `Keyboard delay (ms)`: The initial delay before an operation will be executed when pressing a keyboard shortcut. A low value will immediately execute a keyboard's associated operation, whereas a high value will delay the execution of an operation. This is useful for preventing an operation being called multiple times when rapidly pressing a key in short succession, e.g. for movement.

- `Move Value (nm/s)`:  A high value will speed up movement through the dataset, e.g. when holding down the spacebar. Vice-versa, a low value will slow down the movement allowing for more precision. This setting is especially useful in `Flight mode`.

- `d/f-Switching`: ¯\_(ツ)_/¯

Viewport Options / Flight Options
- `Zoom`: The zoom factor for viewing the dataset. A low value moves the camera really close to the data, showing many details. A high value, will you show more of the dataset but with fewer details and is great for getting an overview or moving around quickly.
- `Viewport Scale`: Increases / Decreases the size of dataset viewports in the center of the screen.
- `Clipping Distance`: The distance between 3D structures and the camera used for hiding ("clipping") structures. Use it to reduce the number of visible nodes in the viewports and declutter your screen.
- `Show Crosshairs`: Shows / Hides the crosshair overlay over the viewports.
- `Mouse Rotation`: Increases / Decreases the movement speed when using the mouse to rotate within the datasets. A low value rotates the camera slower for more precisie movements. A high value rotates the camera quicker for greater agility. 
- `Keyboard Rotation`: Increases / Decreases the movement speed when using the arrow keys on the keyboard to rotate within the datasets. A low value rotates the camera slower for more precisie movements. A high value rotates the camera quicker for greater agility. 
- `Crosshair Size`: Controls the size of the crosshair in flight mode.
- `Sphere Radius`: In flight mode, the data is projected on the inside of a sphere with the camera located at the center of the sphere. This option influences the radius of said sphere flattening / rounding the projected viewport. A high value will cause less curvature showing the detail with more detail and less distortion. A low value will show more data along the edges of the viewport. 

Nodes & Trees
- `Active Node ID`: Contains the active node's ID. Enter a valid node ID to quickly navigate to it within the dataset and set it active for future operations.
- `Active Tree ID`: Contains the active tree's ID. Enter a valid tree ID to quickly navigate to the last node of the tree and set it active for future operations.
- `Node Radius`: Controls the size of each individual node. Large values will create big nodes, small values create tiny nodes. Each node can have a different size. This is useful for annotations where node sizes have a meaning.
- `Particle Size`: Controls the minimum node size for all nodes. This will override nodes with a too small node radius.
- `Override Node Radius`: When toggled, overrides all individual node sizes. This allows to uniformly adjust the size of all nodes simultaneously.
- `Soma Clicking`: When active every mouse click (left mouse button), will create a new tree. Use this for annotations were highlighting/marking structures is more important than labeling connected structures, e.g. for marking all Somas in a dataset.
- `Highlight Commented Nodes`: When active, nodes that have a comment associated with them will be rendered with a slight board around them. This is useful for quickly identifying (important) nodes.

Other
- `Bounding Box`: Users can set a custom bounding box that will be displayed in all viewports. Useful for orientation when working in a specific area of a dataset. Format: minX, minY, minZ, width, height, depth
- `Display Planes in 3D View`: Toggles the visibility of the data layers in the 3D viewport. This is useful if you want to view your nodes or a large skeleton in the 3D view without them being covered by the data layers.


### Dataset Settings
For multi-layer datasets, each layer can be adjusted seperately. 

Colors
- `Brightness`: Increase / Decrease the brightness of the data layer.
- `Contrast`: Increase / Decrease the contrast of the data layer.
- `Color`: Every data layer can be colored to make them easily identifiable. By default, all layers have a white overlay, showing the true, raw black & white data.

Segmentation
- `Segmentation Opacity`: Increases / Decreases the opacity of the segmentation layer. A low value will make the segmentation almost transparent letting you see the underlaying data layers more clearly. A high value will make the segmentation opaque which is useful for adjusting and reviewing the exact fit of the segementation layer. Only possible if your dataset has a segementation layer.
- `Highlight Hovered Cells`: Toggles wether segmented cells will be highlighted in all viewports when hovering over them with the mouse cursor. Useful for identifiying the highlighted cell in across all viewports.

Quality
- `4 Bit`: Toggles data download form the server using only 4 Bit instead of 8 Bit for each pixel. Use this to reduce the amount of necessary internet bandwidth for wK. Useful for show casing data on the go over cellular networks, e.g 4G. 
- `Quality`: Adjusts the quality level used for data download from the server. "High" will load the original, unmodified data. "Medium" and "Low" will load a downsampled version of the data layer to reduce network traffic. Use this to reduce the amount of necessary internet bandwidth for wK.

