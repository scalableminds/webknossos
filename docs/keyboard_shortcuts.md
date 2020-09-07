# Keyboard & Mouse Shortcuts

Find all available keyboard & mouse shortcuts for webKnossos listed below.

## General

| Key Binding                   | Operation                                   |
| ----------------------------- | ------------------------------------------- |
| CTRL / CMD + Z                | Undo                                        |
| CTRL / CMD + Y                | Redo                                        |
| CTRL / CMD + S                | Save                                        |
| I or ALT + Mousewheel         | Zoom In                                     |
| O or ALT + Mousewheel         | Zoom Out                                    |
| P                             | Select Previous Comment                     |
| N                             | Select Next Comment                         |
| 3                             | Toggle Segmentation Opacity                 |
| H                             | Increase the Move Value                     |
| G                             | Decrease the Move Value                     |
| Q                             | Download Screenshot(s) of Viewport(s)       |
| .                             | Toggle Viewport Maximization                |

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

| Key Binding                           | Operation                                   |
| ------------------------------------- | ------------------------------------------- |
| Left Mouse Drag or Arrow Keys         | Move In-Plane                               |
| Alt + Mouse Move                      | Move In-Plane                               |
| SPACE                                 | Move Forward                                |
| Scroll Mousewheel (3D View)           | Zoom In And Out                             |
| Right Click Drag (3D View)            | Rotate 3D View                              |
| Right Click                           | Create New Node                             |
| C                                     | Create New Tree                             |
| SHIFT + Left Click                    | Select Node (Mark as Active Node)           |
| CTRL + .                              | Navigate to subsequent Node (Mark as Active)|
| CTRL + ,                              | Navigate to preceding Node (Mark as Active) |
| CTRL + Left Click / CTRL + Arrow Keys | Move the Active Node                        |
| SHIFT + ALT + Left Click      | Merge Two Nodes and Combine Trees                   |
| SHIFT + CTRL + Left Click     | Delete Edge / Split Trees                           |
| Del                           | Delete Node / Split Trees                           |
| B                             | Mark Node as New Branchpoint                        |
| J                             | Jump To Last Branchpoint                            |
| S                             | Center Camera on Active Node                        |

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
| CTRL + Left Mouse Drag            | Add Empty Voxels To Current Cell (in Trace / Brush Mode); i.e., does not overwrite other cells    |
| Right Mouse Drag                  | Remove Voxels From Current Cell                             |
| CTRL + Right Mouse Drag           | Remove Voxels From Any Cell                                 |
| Alt + Mouse Move                  | Move                                                        |
| C                                 | Create New Cell                                             |
| W, 1                              | Toggle Modes (Move / Trace / Brush)                         |
| SHIFT + Mousewheel or SHIFT + I, O | Change Brush Size (Brush Mode)                              |
| V                                 | Copy Segmentation of Current Cell From Previous Slice       |
| SHIFT + V                         | Copy Segmentation of Current Cell From Next Slice           |

## Mesh Related Shortcuts

The following bindings only work if isosurface rendering is activated in the settings and a segmentation exists.

| Key Binding                                            | Operation                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| Shift + Click on a segment in the orthogonal viewports | Initiate isosurface rendering for that cell                 |
| Shift + Click on a segment in the 3D viewport          | Change the active position to the clicked position          |
| Ctrl + Click on a segment in the 3D viewport           | Remove the isosurface of the clicked cell                   |

