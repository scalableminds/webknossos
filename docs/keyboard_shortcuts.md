# Keyboard & Mouse Shortcuts

The most important shortcuts are always shown in the status bar at the bottom of the screen.
These shortcut hints depend on the active tool and also change when modifiers are pressed to allow easy exploration of available functionality.

A complete listing of all available keyboard & mouse shortcuts for WEBKNOSSOS can be found below.

## General

| Key Binding                   | Operation                                   |
| ----------------------------- | ------------------------------------------- |
| CTRL/CMD + Z                | Undo                                        |
| CTRL/CMD + Y                | Redo                                        |
| CTRL/CMD + S                | Save                                        |
| I or CTRL/CMD + Mousewheel        | Zoom In                                     |
| O or CTRL/CMD + Mousewheel        | Zoom Out                                    |
| P                             | Select Previous Comment                     |
| N                             | Select Next Comment                         |
| 3                             | Toggle Segmentation Opacity                 |
| H                             | Increase the Move Value                     |
| G                             | Decrease the Move Value                     |
| Q                             | Download Screenshot(s) of Viewport(s)       |
| .                             | Toggle Viewport Maximization                |
| K, L                          | Toggle Sidebars                             |

## Skeleton Annotation Mode

| Key Binding                   | Operation                                   |
| ----------------------------- | ------------------------------------------- |
| M                             | Toggle Mode (Orthogonal, Flight, Oblique)   |
| 1                             | Toggle Visibility of all Trees              |
| 2                             | Toggle Visibility of Inactive Trees         |
| SHIFT + Mousewheel            | Change Node Radius                          |
| CTRL/CMD + SHIFT + F              | Open Tree Search (if Tree List is visible)  |
| F or Mousewheel               | Move Forward by a Single Slice              |
| D or Mousewheel               | Move Backward by a Single Slice             |

### Orthogonal Mode

Note that skeleton-specific mouse actions are usually only available when the skeleton tool is active.

| Key Binding                           | Operation                                   |
| ------------------------------------- | ------------------------------------------- |
| Left Mouse Drag or Arrow Keys         | Move In-Plane                               |
| Alt + Mouse Move                      | Move In-Plane                               |
| SPACE                                 | Move Forward                                |
| Scroll Mousewheel (3D View)           | Zoom In And Out                             |
| Right-Click Drag (3D View)            | Rotate 3D View                              |
| Left Click                            | Create New Node                             |
| Left Click                            | Select Node (Mark as Active Node) under cursor  |
| Left Drag                             | Move node under cursor                      |
| Right Click (on node)                 | Bring up the context-menu with further actions  |
| SHIFT + ALT + Left Click              | Merge Two Nodes and Combine Trees           |
| SHIFT + CTRL/CMD + Left Click             | Delete Edge / Split Trees                   |
| C                                     | Create New Tree                             |
| CTRL/CMD + .                              | Navigate to the next Node (Mark as Active)  |
| CTRL/CMD + ,                              | Navigate to previous Node (Mark as Active)  |
| CTRL/CMD + Left Click / CTRL/CMD + Arrow Keys | Move the Active Node                        |
| Del                                   | Delete Node / Split Trees                   |
| B                                     | Mark Node as New Branchpoint                |
| J                                     | Jump To Last Branchpoint                    |
| S                                     | Center Camera on Active Node                |


Note that you can enable *Classic Controls* which will behave slightly different and more explicit for the mouse actions:

| Key Binding                   | Operation                           |
| ----------------------------- | -------------                       |
| Right Click                   | Create New Node                     |
| SHIFT + Left Click            | Select Node (Mark as Active Node)   |


### Flight / Oblique Mode

| Key Binding                   | Operation                                  |
| ----------------------------- | ------------------------------------------ |
| Left Click                    | Select Node (Mark as Active Node) under cursor |
| Left Mouse Drag or Arrow Keys | Rotation                                   |
| SPACE                         | Move Forward                               |
| CTRL/CMD + SPACE                  | Move Backward                              |
| I, O                          | Zoom In And Out                            |
| SHIFT + Arrow                 | Rotation Around Axis                       |
| R                             | Invert Direction                           |
| B                             | Mark Node as New Branchpoint               |
| J                             | Jump To Last Branchpoint                   |
| S                             | Center Active Node                         |
| F                             | Forward Without Recording Waypoints        |
| D                             | Backward Without Recording Waypoints       |
| Del                           | Delete Node / Split Trees                  |
| SHIFT + SPACE                 | Delete Active Node, Recenter Previous Node |
| SHIFT + ALT + Left Click      | Merge Two Nodes and Combine Trees          |
| SHIFT + CTRL/CMD + Left Click     | Delete Edge / Split Trees                  |

## Volume Mode

| Key Binding                       | Operation                                                   |
| --------------------------------- | ----------------------------------------------------------- |
| Left Mouse Drag or Arrow Keys     | Move (Move Mode) / Add To Current Segment (Trace / Brush Mode) |
| Right Click                       | Bring up context-menu with further actions                     |
| SHIFT + Left Click                | Select Active Segment                                          |
| CTRL/CMD + Left Mouse Drag            | Add Voxels To Current Segment while inverting the overwrite-mode (see toolbar for overwrite-mode) |
| CTRL/CMD + SHIFT + Left Mouse Drag    | Remove Voxels From Segment                                     |
| Alt + Mouse Move                  | Move                                                        |
| C                                 | Create New Segment                                             |
| SHIFT + Mousewheel or SHIFT + I, O | Change Brush Size (Brush Mode)                             |
| V                                 | Interpolate current segment between last labeled and current slice |

Note that you can enable *Classic Controls* which won't open a context menu on right-click, but instead erases when the brush/trace tool is activated.

| Key Binding                       | Operation                                                   |
| --------------------------------- | ----------------------------------------------------------- |
| Right Mouse Drag                  | Remove Voxels                                               |
| CTRL/CMD + Right Mouse Drag           | Remove Voxels while inverting the overwrite-mode (see toolbar for overwrite-mode) |

## Tool Switching Shortcuts

Note that you need to first press CTRL/CMD + K, release these keys and then press the letter that was assigned to a specific tool in order to switch to it.  
CTRL/CMD + K is not needed for cyclic tool switching via W / SHIFT + W.

| Key Binding                       | Operation                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------- |
| W                                 | Cycle Through Tools (Move / Skeleton / Trace / Brush / ...)                       |
| SHIFT + W                         | Cycle Backwards Through Tools (Move / Proofread / Bounding Box / Pick Cell / ...) |
| CTRL/CMD + K, **M**                       | Move Tool                                                                         |
| CTRL/CMD + K, **S**                       | Skeleton Tool                                                                     |
| CTRL/CMD + K, **B**                       | Brush Tool                                                                        |
| CTRL/CMD + K, **E**                       | Brush Erase Tool                                                                  |
| CTRL/CMD + K, **L**                       | Lasso Tool                                                                        |
| CTRL/CMD + K, **R**                       | Lasso Erase Tool                                                                  |
| CTRL/CMD + K, **P**                       | Segment Picker Tool                                                               |
| CTRL/CMD + K, **Q**                       | Quick Select Tool                                                                 |
| CTRL/CMD + K, **X**                       | Bounding Box Tool                                                                 |
| CTRL/CMD + K, **O**                       | Proofreading Tool                                                                 |

### Brush Related Shortcuts

Note that you need to first press CTRL/CMD + K, release these keys and press the suitable number.

| Key Binding                       | Operation                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------- |
| CTRL/CMD + K, **1**                       | Switch to small brush                                                             |
| CTRL/CMD + K, **2**                       | Switch to medium sized brush                                                      |
| CTRL/CMD + K, **3**                       | Switch to large brush                                                             |

## Mesh Related Shortcuts

| Key Binding                                            | Operation                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| Shift + Click on a mesh in the 3D viewport          | Move the camera to the clicked position          |
| CTRL/CMD + Click on a mesh in the 3D viewport           | Unload the mesh from WEBKNOSSOS    |

## Agglomerate File Mapping Skeleton

The following binding only works in skeleton/hybrid annotations and if an agglomerate file mapping is activated.

| Key Binding                     | Operation                                 |
| ------------------------------- | ----------------------------------------- |
| SHIFT + Middle Click            | Import Skeleton for Selected Segment      |

## Classic Controls

Note that you can enable *Classic Controls* in the left sidebar. 
Classic controls are provided for backward compatibility for long-time users and are not recommended for new user accounts.
Hence, Classic controls are disabled by default, and WEBKNOSSOS uses a more intuitive behavior which assigns the most important functionality to the left mouse button (e.g., moving around, selecting/creating/moving nodes). The right mouse button always opens a context-sensitive menu for more complex actions, such as merging two trees.
With classic controls, several mouse controls are modifier-driven and may also use the right-click for actions, such as erasing volume data.
