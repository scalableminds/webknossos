# Keyboard & Mouse Shortcuts

The most important shortcuts are always shown in the status bar at the bottom of the screen.
These shortcut hints depend on the active tool and also change when modifiers are pressed to allow easy exploration of available functionality.

A complete listing of all available keyboard & mouse shortcuts for webKnossos can be found below.

## Classic Controls

Note that you can enable *Classic Controls* in the left sidebar.
Without classic controls (which is the default), a more intuitive behavior is used which assigns the most important functionality to the left mouse button (e.g., moving around, selecting/creating/moving nodes) while the right mouse button always opens a context-sensitive menu for more complex actions, such as merging two trees.
With classic controls, several mouse controls are modifier-driven and may also use the right-click for actions, such as erasing volume data.

## General

| Key Binding                   | Operation                                   |
| ----------------------------- | ------------------------------------------- |
| CTRL / CMD + Z                | Undo                                        |
| CTRL / CMD + Y                | Redo                                        |
| CTRL / CMD + S                | Save                                        |
| I or CTRL + Mousewheel        | Zoom In                                     |
| O or CTRL + Mousewheel        | Zoom Out                                    |
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
| CTRL + SHIFT + F              | Open Tree Search (if Tree List is visible)  |
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
| Left Drag                             | Move node under cursor                |
| C                                     | Create New Tree                             |
| CTRL + .                              | Navigate to the next Node (Mark as Active)|
| CTRL + ,                              | Navigate to previous Node (Mark as Active) |
| CTRL + Left Click / CTRL + Arrow Keys | Move the Active Node                        |
| Del                           | Delete Node / Split Trees                           |
| B                             | Mark Node as New Branchpoint                        |
| J                             | Jump To Last Branchpoint                            |
| S                             | Center Camera on Active Node                        |


Note that you can enable *Classic Controls* which will behave slightly different and more explicit for the mouse actions:

| Key Binding                   | Operation                           |
| ----------------------------- | -------------                       |
| Right Click                   | Create New Node                     |
| SHIFT + Left Click            | Select Node (Mark as Active Node)   |
| SHIFT + Left Click            | Select Node (Mark as Active Node)   |
| SHIFT + ALT + Left Click      | Merge Two Nodes and Combine Trees   |
| SHIFT + CTRL + Left Click     | Delete Edge / Split Trees           |


### Flight / Oblique Mode

| Key Binding                   | Operation                                  |
| ----------------------------- | ------------------------------------------ |
| Left Mouse Drag or Arrow Keys | Rotation                                   |
| SPACE                         | Move Forward                               |
| CTRL + SPACE                  | Move Backward                              |
| I, O                          | Zoom In And Out                            |
| SHIFT + Arrow                 | Rotation Around Axis                       |
| R                             | Invert Direction                           |
| B                             | Mark Node as New Branchpoint               |
| J                             | Jump To Last Branchpoint                   |
| S                             | Center Active Node                         |
| F                             | Forward Without Recording Waypoints        |
| D                             | Backward Without Recording Waypoints       |
| SHIFT + SPACE                 | Delete Active Node, Recenter Previous Node |


## Volume Mode

| Key Binding                       | Operation                                                   |
| --------------------------------- | ----------------------------------------------------------- |
| Left Mouse Drag or Arrow Keys     | Move (Move Mode) / Add To Current Cell (Trace / Brush Mode) |
| SHIFT + Left Click                | Select Active Cell                                          |
| CTRL + Left Mouse Drag            | Add Voxels To Current Cell while inverting the overwrite-mode (see toolbar for overwrite-mode) |
| CTRL + SHIFT + Left Mouse Drag    | Remove Voxels From Cell                                     |
| Alt + Mouse Move                  | Move                                                        |
| C                                 | Create New Cell                                             |
| W                                 | Toggle Modes (Move / Skeleton / Trace / Brush / ...)        |
| SHIFT + Mousewheel or SHIFT + I, O | Change Brush Size (Brush Mode)                             |
| V                                 | Copy Segmentation of Current Cell From Previous Slice       |
| SHIFT + V                         | Copy Segmentation of Current Cell From Next Slice           |

Note that you can enable *Classic Controls* which won't open a context menu on right-click, but instead erases when the brush/trace tool is activated.

| Key Binding                       | Operation                                                   |
| --------------------------------- | ----------------------------------------------------------- |
| Right Mouse Drag                  | Remove Voxels                                               |
| CTRL + Right Mouse Drag           | Remove Voxels while inverting the overwrite-mode (see toolbar for overwrite-mode) |

## Mesh Related Shortcuts

The following bindings only work if isosurface rendering is activated in the settings and a segmentation exists.

| Key Binding                                            | Operation                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| Shift + Click on a segment in the 3D viewport          | Change the active position to the clicked position          |
| Ctrl + Click on a segment in the 3D viewport           | Remove the isosurface of the clicked cell                   |

## Agglomerate File Mapping Skeleton

The following binding only works in skeleton/hybrid annotations and if an agglomerate file mapping is activated.

| Key Binding                     | Operation                                 |
| ------------------------------- | ----------------------------------------- |
| SHIFT + Middle Click            | Import Skeleton for Selected Segment      |
