# Understanding the User Interface

The main webKnossos user interface for viewing and annotating datasets is divided into five sections.

1. A toolbar for general purposes features such as Saving your work and displaying the current position within the dataset. Further, it provides access to all the tools for annotationg and manipulating your data. It spans along the full width of the top of your screen.
2. The left-hand sidepanel provides a list of all available data, segmentation, and annotation layers as well as a settings menu for viewport options and keyboard controls.
3. The center of the screen is occupied by the annotation interface. Your dataset is displayed here and you navigate and annotate it as desired. Most interactions will take place here.
4. The right-hand sidepanel is occupied by several tabs providing more information on your current dataset, skeleton/volume annotations, and other lists. Depending on your editing mode these tabs might adapt.
5. The bottom of the screen is covered by a status bar showing context-sensitve hints for mouse controls as well as additional information on mouse hover.

![An overview of the webKnossos annotation UI highlighting the 4 main sections of the interface](images/tracing_ui_overview.png)

[Read More About Skeleton Annotation](./skeleton_annotation.md)
[Read More About Volume Annotation](./volume_annotation.md)

## The Toolbar
The toolbar contains frequently used commands, such as saving and sharing, your current position within the dataset and the ability to switch between various modes for viewing. Further, it provides access to all the tools for annotation, navigation, and more.

The most common buttons are:
- `Settings`: Toggles the visibility of the left-hand sidepanel with all data and segmentation layers and their respective settings.
- `Undo` / `Redo`: Undoes the last operation or redoes it if no new changes have been made in the meantime. Undo can only revert changes made in this session (since the moment the annotation view was opened). To revert to older versions use the "Restore Older Version" functionality, described later in this list.
- `Save`: Saves your annotation work. webKnossos automatically saves every 30 seconds.
- `Archive`: Closes the annotation and archives it, removing it from a user's dashboard. Archived annotations can be found on a user's dashboard under "My Annotations" and by clicking on "Show Archived Annotations". Use this to declutter your dashboard. (Not available for tasks)
- `Download`: Starts a download of the current annotation including any skeleton and volume data. Skeleton annotations are downloaded as [NML](./data_formats.md#nml) files. Volume annotation downloads contain the raw segmentation data as [WKW](./data_formats.md#wkw) files.
- `Share`: Create a shareable link to your dataset containing the current position, rotation, zoom level etc. Use this to collaboratively work with colleagues. Read more about this feature in the [Sharing guide](./sharing.md).
- `Add Script`: Using the [webKnossos frontend API](https://webknossos.org/assets/docs/frontend-api/index.html) users can script and automate webKnossos interactions. Enter and execute your user scripts (Javascript) from here. Admins can curate a collection of frequently used scripts for your organization and make them available for quick selection to all users.
- `Restore Older Version`: Opens a window that shows all previous versions of an annotation. webKnossos keeps a complete version history of all your changes to an annotation (separate for skeleton/volume). From this window, any older version can be selected, previewed, and restored.

A user can directly jump to any position within their datasets by entering them in the position input field.
The same is true for the camera rotation in flight/oblique modes.
Clicking on the position or rotation labels copies the values to the clipboard.

![The webKnossos toolbar contains many useful features for quick access such as Saving und Undo/Redo](images/tracing_ui_toolbar.png)

// TODO Tools
The toolbar further features al available navigation and annotation tools for quick access:

- `Move`: Navigate around the dataset.
- `Skeleton`: Create skeleton annotations and place nodes. [Read more about skeleton annotations](./skeleton_annotation.md#tools).
- `Trace`: Creates volume annotations by drawing outlines around the voxel you would like to label. [Read more about volume annotations](./volume_annotation.md#tools).
- `Brush`: Creates volume annotations by drawing over the voxels you would like to label. 
- `Erase (Trace/Brush)`: Removes voxels from a volume annotation by drawing over the voxels you would like to erase. 
- `Fill Tool`: Flood-fills the clicked region with a volume annotation until it hits the next segment boundary (or the outer edge of you viewport). Used to fill holes in a volume annotation or to relabel a segment with a different id. 
- `Segment Picker`: Select the volume annotation ID of a segment to make it the active cell id to continue labelling with that ID/color.
- `Bounding Box`: Creates and resizes any bounding box. See also the BoundingBox panel below.

Please see the detailed documentation on [skeleton](./skeleton_annotation.md#tools) and [volume annotation](./volume_annotation.md#tools) tools for a for explaination of all context-sensitve modifiers that are available to some tools.

// todo add image of toolbar

## Layers and Settings
The left-hand sidepanel features both a list of all available data and annotation layers as well as settings menu to fine-tune some parameters of webKnossos.
All settings are automatically saved as part of a user's profile.

### Layers Tab
Each dataset consists of one or more data and annotation layers. A dataset typically has a at least of `color` layer containing the raw microscopy/etc image. Additional layers can include segmentations, skeleton and volume annotations. Each layer has several settings to adjust the viewing experience:

#### Histogram & General Layer Properties
- `Histogram`: The Histogram displays sampled color values of the dataset on a logarithmic scale. The slider below the Histogram can be used to adjust the dynamic range of the displayed values. In order to increase the contrast of data, reduce the dynamic range. To decrease the contrast, widen the range. In order to increase the brightness, move the range to the left. To decrease the brightness, move the range to the right.

    Above the the histogram, the are icon buttons further adjust the histogram or otherwise interacte with layer:
        - `pencil`: Manipulate the min/max value of the dynamic range. Clips values above/below these limits. 
        - `vertical line`: Automatically adjust the histogram for best contrast. Contrast estimation is based on the data currently availabe in you viewport.
        - `circle arrow`: Reload the data from server. Useful if the raw data has been change on disk and you want to refresh you current session.
        - `scanner`: Navigates the webKnossos camera to a position within the dataset where there is data available for the respective layer. This is especially useful for working with smaller layers - likely segmentations - that might not cover the whole dataset and are hard to find manually. 

- `Opacity`: Increase / Decrease the opacity of the data layer. 0% opacity makes a layer invisible. 100% opacit y makes it totally opaque. Useful for overlaying several layers above one another.
- `Visibility`: Use the eye icon on the left side of layer name to enable/disable it. Toggeling the visibility of a layer is often the quickest way to make information available in the dataset or hide to get an overview. 
Disabeling the visibility, unloads/frees these ressources from your GPU hardware and can make viewing larger datasets more performant. Also, depending on your GPU hardware, there is a phyiscal upper limit for how many layers - typically 16 or more - can be displayed at any time (WebGL limitation). Toggle layers as needed to migite this.

//TODO add imaeg of histogram

#### Color and Segmentation Layers
In addition to general layer properties mentioned above, `color`and `segmentation`layer come with a number of other settings:

- `Color`: Every `color` layer can be re-colored to make it easily identifiable. By default, all layers have a white overlay, showing the true, raw black & white data. Clicking on the square color indicator brings up your system's color palette to choose from. Note, there is icon button for inverting all color values in this layer.
- `Pattern Opacity`: Adjust the visibility of the texture/pattern on each segment. To make segments easier to distinguish and more unique, a pattern is applied to each in addtion to its base color. 0% hides the pattern. 100% makes the pattern very prominent. Great for increasing the visual contrast between segments.
- `ID Mapping`: webKnossos supports applying pre-computed agglomerations/groupings of segmentation IDs for a given segmentation layer. This is very powerful feature to explore and compare different segmentation strategies for a given segmentation layer. Mappings need to be pre-computed and stored together with a dataset for webKnossos to download and apply. [Read more about this here](./data_formats.md).

![Video: Visualize Machine-Learning Predictions](https://www.youtube.com/watch?v=JZLKB9GfMgQ)

#### Skeleton Annotation Layer
The skeleton annotation layer contains any skeletons/trees that you add to your dataset. You can quickly toggle the visbility of all skeletons by enabling/disabling this layer.

- `Node Radius`: Controls the size property of each individual node. Large values will render big nodes, small values create tiny nodes. Each node can have a different size. This is useful for annotations where node sizes encode a meaning.
- `Particle Size`: Controls the minimum node size for all nodes. This will globally override nodes with a too small node radius. Used together with the `Override Node Radius` below. 
- `Clipping Distance`: The distance between 3D structures and the camera used for hiding ("clipping") structures. Use it to reduce the number of visible nodes in the viewports and declutter your screen.
- `Override Node Radius`: When toggled, globally overrides all individual node sizes. This allows to uniformly adjust the size of all nodes simultaneously. Used together with the `Particle Size` setting.
- `Auto-center Nodes`: Per default, each time you place a node in a skeleton annotation, the webKnossos viewport will center on this node. Disable, if you do not want the viewport to move/reposition while clicking nodes. 
- `Highlight Commented Nodes`: When active, nodes that have a comment associated with them will be rendered with a slight board around them. This is useful for quickly identifying (important) nodes.


###  Settings Tab
Note, not all control/viewport settings are available in every annotation mode.

#### Controls
- `Keyboard delay (ms)`: The initial delay before an operation will be executed when pressing a keyboard shortcut. A low value will immediately execute a keyboard's associated operation, whereas a high value will delay the execution of an operation. This is useful for preventing an operation being called multiple times when rapidly pressing a key in short succession, e.g. for movement.

- `Move Value (nm/s)`:  A high value will speed up movement through the dataset, e.g. when holding down the spacebar. Vice-versa, a low value will slow down the movement allowing for more precision. This setting is especially useful in `Flight mode`.

- `d/f-Switching`: If d/f switching is disabled, moving through the dataset with `f` will always go *f*orward by *increasing* the coordinate orthogonal to the current slice. Correspondingly, `d` will backwards by decreasing that coordinate. However, if d/f is enabled, the meaning of "forward" and "backward" will change depending on how you create nodes. For example, when a node is placed at z == 100 and afterwards another node is created at z == 90, z will be *decreased* when going forward.

- `Classic Controls`: Disabled by default to provide the best webKnossos user experience. When enabled, several keyboard shortcuts and mouse interactions change to maintain backwards compatibility for long-time users.  See also the section on [Keyboard Controls](./keyboard_shortcuts#Classic_Controls).

#### Viewport Options / Flight Options
- `Zoom`: The zoom factor for viewing the dataset. A low value moves the camera really close to the data, showing many details. A high value, will you show more of the dataset but with fewer details and is great for getting an overview or moving around quickly.
- `Show Crosshairs`: Shows / Hides the crosshair overlay over the viewports.
- `Show Scalebars`: Shows / Hides the scale bars overlay over the viewports.
- `Mouse Rotation`: Increases / Decreases the movement speed when using the mouse to rotate within the datasets. A low value rotates the camera slower for more precise movements. A high value rotates the camera quicker for greater agility.
- `Keyboard Rotation`: Increases / Decreases the movement speed when using the arrow keys on the keyboard to rotate within the datasets. A low value rotates the camera slower for more precise movements. A high value rotates the camera quicker for greater agility.
- `Crosshair Size`: Controls the size of the crosshair in flight mode.
- `Sphere Radius`: In flight mode, the data is projected on the inside of a sphere with the camera located at the center of the sphere. This option influences the radius of said sphere flattening / rounding the projected viewport. A high value will cause less curvature showing the detail with more detail and less distortion. A low value will show more data along the edges of the viewport.

#### Data Rendering
- `Hardware Utilization`: Adjusts the quality level used for rendering data. Changing this setting influences how many data is downloaded from the server as well as how much pressure is put on the user's graphics card. Tune this value to your network connection and hardware power. After changing the setting, the page has to be refreshed.
- `Loading Strategy`: You can choose between two different loading strategies. When using "best quality first" it will take a bit longer until you see data, because the highest quality is loaded. Alternatively, "Progressive quality" can be chosen which will improve the quality progressively while loading. As a result, initial data will be visible faster, but it will take more time until the best quality is shown.
- `4 Bit`: Toggles data download from the server using only 4 Bit instead of 8 Bit for each pixel. Use this to reduce the amount of necessary internet bandwidth for webKnossos. Useful for showcasing data on the go over cellular networks, e.g 3G.
- `Interpolation`: When interpolation is enabled, bilinear filtering is applied while rendering pixels between two voxels. As a result, data may look "smoother" (or blurry when being zoomed in very far). Without interpolation, data may look more "crisp" (or pixelated when being zomed in very far).
- `Render Missing Data Black`: If a dataset doesn't contain data at a specific position, webKnossos can either render "black" at that position or it can try to render data from another magnification.

## Right-Hand Sidepanel
The right-hand sidepanel includes a number of tabs with specific information, additional interactions, listings about your current skeleton and/or volume annotation. When working with any of the webKnossos annotation tools (see above), any interactions with the dataset will lead to entries in the listing provided here.

- `Info`: Contains mostly metainformation about the dataset and annotation. Can be used to name an annotation and provide additional description, e.g. when sharing with collaborators. Includes a button to start [automated analysis](./automated_analysis.md) on your dataset (beta feature). 
- `Skeleton`: Lists all available skeleton annotations and offer further interactions with them. [Read more about skeleton annotations.](./skeleton_annotation.md)
- `Comments`: Lists all comments assigned to individual nodes of a skeleton. [Read more about comments and skeleton annotations.](./skeleton_annotation.md#nodes_and_trees)
- `Segments`: List all segments created during a volume annotation. It also provides access to mesh generation for indivual segments or the whole dataset, mesh visualization, mesh downloads, and more. [Read more about 3D meshes.](./mesh_visualization.md)
- `BBoxes`: List all bounding boxes present in the dataset. Create new bounding boxes or adjust existing ones. This provides an alternativ interface for the `BoundingBox` tool.
- `AbsTree`: Renders and abstract 2D tree representation of a skeleton annotation when enabled. Might be quite ressource intense when working with large skeletons.


## Status Bar

The status bar at the bottom of the screen serves three functions. 
1. It shows context-sensitive mouse and keyboard control hint. Depending on you selected annotation tool, any pressed modifier keys (Shift, CMD, CTRL, ALT, etc), and the object under the mouse, it provides useful interaction hints and shortcuts.
2. It provides useful information basd on your mouse positioning and which objects it hovers over. This includes the current mouse position in the dataset coordinate space, any segment ID that you hover over, and the currently rendered magnification level (MipMap image pyramid) used for displaying any data.
3. When working with skeletons, the active node and tree IDs are listed. Use the little pencil icon to select/mark a specific ID as active if required. For more about the active node ID, [see the section on skeleton annotations](./skeleton_annotation.md#nodes_and_trees). 