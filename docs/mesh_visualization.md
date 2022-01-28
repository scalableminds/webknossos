# Mesh Visualization
webKnossos offers two different methods to render and visualize volumetric segmentations as 3D meshes.

1. Load a pre-computed 3D mesh. Meshes can either be (pre-)computed from within webKnossos for a whole dataset or outside of webKnossos with a `mesh file`. These mesh will be instantly available the next time you open the dataset. (quicker mesh loading time)
2. Compute an ad-hoc mesh of any segmentation layer or volume annotation. These meshes will live-computed any time you request them.  (slower mesh loading time)

Mesh will always be rendered in the 3D viewport in the lower right. 

// todo show mesh in 3d viewport

## Loading Meshes
Regardless of the method, mesh can be loaded by right-clicking on any segment and bringing up the context-sensitive action menu. Select `Load Mesh (precomputed)` or `Compute Mesh (ad-hoc)` to load the respective 3D mesh for that segment.

Alternatively, the `Segments` tab in the right-hand sidepanel, allows you to load the mesh for any segment listed there. Select the corresponding option from the overflow menu next to each list entry.

// todo image of context-sensitve menu with Compute Mesh option
// todo image of segments tab with overlfow menu open

## Working with Meshes
Any mesh listed in the `Segments` tab can be downloaded as an industry standard STL file for further rendering/animation, e.g. in Blender. Hover over the list entry for the disiered mesh to reveal a shortcut menu for downloading, reloading, and unloading/removing meshes.

Mesh visiblity can also be triggered from the `Segments` tab.

Shift + Click on any mesh in the 3D viewport will navigate webKnosso to that postion.
CTRL + Click on any mesh will unload that mesh.

// todo show image of segments tab

## Pre-Computed Mesh Generation
Instead of having to slowly compute individal mesh every time you open a dataset, it might make more sense to pre-compute all meshes within a dataset. Pre-computed mesh have the advantage of loading really quickly - even for larger meshes.

You can start the mesh generation from the `Segments' tab in the right-hand sidepanel. Click on the little plus button to initiate the mesh generation. We recommend to compute the mesh in the medium quality (default) to strike a good balance between visual fidelity, compute time, and GPU ressource usage.

Check the `Processing Jobs` page from the `Admin` menu at the top of the screen to track progress or cancel the operation. The finished, pre-computed mesh will available on page reload. 