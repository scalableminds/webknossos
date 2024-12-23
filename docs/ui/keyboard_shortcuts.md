# Keyboard & Mouse Shortcuts

The most important shortcuts are always shown in the status bar at the bottom of the screen.
These shortcut hints depend on the active tool and also change when modifiers are pressed to allow easy exploration of available functionality.

A complete listing of all available keyboard & mouse shortcuts for WEBKNOSSOS can be found below.

## General

| Key Binding                               | Operation                                   |
| ----------------------------------------- | ------------------------------------------- |
| ++ctrl++ / ++cmd++ + ++z++                | Undo                                        |
| ++ctrl++ / ++cmd++ + ++y++                | Redo                                        |
| ++ctrl++ / ++cmd++ + ++s++                | Save                                        |
| ++i++ or ++ctrl++ / ++cmd++ + Mousewheel  | Zoom In                                     |
| ++o++ or ++ctrl++ / ++cmd++ + Mousewheel  | Zoom Out                                    |
| ++p++                                     | Select Previous Comment                     |
| ++n++                                     | Select Next Comment                         |
| ++3++                                     | Toggle Segmentation Opacity                 |
| ++h++                                     | Increase the Move Value                     |
| ++g++                                     | Decrease the Move Value                     |
| ++q++                                     | Download Screenshot(s) of Viewport(s)       |
| ++period++                                | Toggle Viewport Maximization                |
| ++k++ , ++l++                             | Toggle left/right Sidebars                  |

## Skeleton Annotation Mode

| Key Binding                               | Operation                                   |
| ------------------------------------------| ------------------------------------------- |
| ++m++                                     | Toggle Mode (Orthogonal, Flight, Oblique)   |
| ++1++                                     | Toggle Visibility of all Trees              |
| ++2++                                     | Toggle Visibility of Inactive Trees         |
| ++shift++ + Mousewheel                    | Change Node Radius                          |
| ++ctrl++ / ++cmd++ + ++shift++ + ++f++    | Open Tree Search (if Tree List is visible)  |
| ++f++ or Mousewheel                       | Move Forward by a Single Slice              |
| ++d++ or Mousewheel                       | Move Backward by a Single Slice             |

### Orthogonal Mode

Note that skeleton-specific mouse actions are usually only available when the skeleton tool is active.

| Key Binding                               | Operation                                   |
| --------------------------------------------- | ------------------------------------------- |
| Left Mouse Drag or Arrow Keys                 | Move In-Plane                               |
| ++alt++ + Mouse Move                          | Move In-Plane                               |
| ++space++                                     | Move Forward                                |
| Scroll Mousewheel (3D View)                   | Zoom In And Out                             |
| Right-Click Drag (3D View)                    | Rotate 3D View                              |
| Left Click                                    | Create New Node                             |
| Left Click                                    | Select Node (Mark as Active Node) under cursor  |
| Left Drag                                     | Move node under cursor                      |
| Right Click (on node)                         | Bring up the context-menu with further actions  |
| ++shift++ + ++alt++ + Left Click              | Merge Two Nodes and Combine Trees           |
| ++shift++ + ++ctrl++ / ++cmd++ + Left Click   | Delete Edge / Split Trees                   |
| ++c++                                         | Create New Tree                             |
| ++ctrl++ / ++cmd++ + ++period++               | Navigate to the next Node (Mark as Active)  |
| ++ctrl++ / ++cmd++ + ++comma++                | Navigate to previous Node (Mark as Active)  |
| ++ctrl++ / ++cmd++ + Left Click or ++ctrl++ / ++cmd++ + Arrow Keys | Move the Active Node                        |
| ++del++                                       | Delete Node / Split Trees                   |
| ++b++                                         | Mark Node as New Branchpoint                |
| ++j++                                         | Jump To Last Branchpoint                    |
| ++s++                                         | Center Camera on Active Node                |


Note that you can enable *Classic Controls* which will behave slightly different and more explicit for the mouse actions:

| Key Binding                   | Operation                           |
| ----------------------------- | -------------                       |
| Right Click                   | Create New Node                     |
| ++shift++ + Left Click        | Select Node (Mark as Active Node)   |


### Flight / Oblique Mode

| Key Binding                       | Operation                                  |
| --------------------------------- | ------------------------------------------ |
| Left Click                        | Select Node (Mark as Active Node) under cursor |
| Left Mouse Drag or Arrow Keys     | Rotation                                   |
| ++space++                         | Move Forward                               |
| ++ctrl++ / ++cmd++ + ++space++    | Move Backward                              |
| ++i++ / ++o++                     | Zoom In And Out                            |
| ++shift++ + Arrow                 | Rotation Around Axis                       |
| ++r++                             | Invert Direction                           |
| ++b++                             | Mark Node as New Branchpoint               |
| ++j++                             | Jump To Last Branchpoint                   |
| ++s++                             | Center Active Node                         |
| ++f++                             | Forward Without Recording Waypoints        |
| ++d++                             | Backward Without Recording Waypoints       |
| ++del++                           | Delete Node / Split Trees                  |
| ++shift++ + ++space++             | Delete Active Node, Recenter Previous Node |
| ++shift++ + ++alt++ + Left Click  | Merge Two Nodes and Combine Trees          |
| ++shift++ + ++ctrl++ / ++cmd++ + Left Click     | Delete Edge / Split Trees                  |

## Volume Mode

| Key Binding                                           | Operation                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Left Mouse Drag or Arrow Keys                         | Move (Move Mode) / Add To Current Segment (Trace / Brush Mode) |
| Right Click                                           | Bring up context-menu with further actions                     |
| ++shift++ + Left Click                                | Select Active Segment                                          |
| ++ctrl++ / ++cmd++ + Left Mouse Drag                  | Add Voxels To Current Segment while inverting the overwrite-mode (see toolbar for overwrite-mode) |
| ++ctrl++ / ++cmd++ + ++shift++ + Left Mouse Drag      | Remove Voxels From Segment                                     |
| ++alt++ + Mouse Move                                  | Move                                                           |
| ++c++                                                 | Create New Segment                                             |
| ++shift++ + Mousewheel or ++shift++ + ++i++ / ++o++ | Change Brush Size (Brush Mode)                                   |
| ++v++                                                 | Interpolate current segment between last labeled and current slice |

Note that you can enable *Classic Controls* which won't open a context menu on right-click, but instead erases when the brush/trace tool is activated.

| Key Binding                           | Operation                                                   |
| ------------------------------------- | ----------------------------------------------------------- |
| Right Mouse Drag                      | Remove Voxels                                               |
| ++ctrl++ / ++cmd++ + Right Mouse Drag | Remove Voxels while inverting the overwrite-mode (see toolbar for overwrite-mode) |

## Tool Switching Shortcuts

Note that you need to first press ++ctrl++ / ++cmd++ + ++k++, release these keys and then press the letter that was assigned to a specific tool in order to switch to it.  
++ctrl++ / ++cmd++ + ++k++ is not needed for cyclic tool switching via ++w++ / ++shift+w++. 

| Key Binding                               | Operation                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| ++w++                                     | Cycle Through Tools (Move / Skeleton / Trace / Brush / ...)                       |
| ++shift++ + ++w++                         | Cycle Backwards Through Tools (Move / Proofread / Bounding Box / Pick Cell / ...) |
| ++ctrl++ / ++cmd++ + ++k++ , **++m++**    | Move Tool                                                                         |
| ++ctrl++ / ++cmd++ + ++k++ , **++s++**    | Skeleton Tool                                                                     |
| ++ctrl++ / ++cmd++ + ++k++ , **++b++**    | Brush Tool                                                                        |
| ++ctrl++ / ++cmd++ + ++k++ , **++e++**    | Brush Erase Tool                                                                  |
| ++ctrl++ / ++cmd++ + ++k++ , **++l++**    | Lasso Tool                                                                        |
| ++ctrl++ / ++cmd++ + ++k++ , **++r++**    | Lasso Erase Tool                                                                  |
| ++ctrl++ / ++cmd++ + ++k++ , **++p++**    | Segment Picker Tool                                                               |
| ++ctrl++ / ++cmd++ + ++k++ , **++q++**    | Quick Select Tool                                                                 |
| ++ctrl++ / ++cmd++ + ++k++ , **++x++**    | Bounding Box Tool                                                                 |
| ++ctrl++ / ++cmd++ + ++k++ , **++o++**    | Proofreading Tool                                                                 |

### Brush Related Shortcuts

Note that you need to first press ++ctrl++ / ++cmd++ + ++k++, release these keys and press the suitable number.

| Key Binding                               | Operation                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| ++ctrl++ / ++cmd++ + ++k++ , **++1++**    | Switch to small brush                                                             |
| ++ctrl++ / ++cmd++ + ++k++ , **++2++**    | Switch to medium sized brush                                                      |
| ++ctrl++ / ++cmd++ + ++k++ , **++3++**    | Switch to large brush                                                             |

## Mesh Related Shortcuts

| Key Binding                                               | Operation                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| ++shift++ + Click on a mesh in the 3D viewport            | Move the camera to the clicked position                     | 
| ++ctrl++ / ++cmd++ + Click on a mesh in the 3D viewport   | Select the mesh and its segment ID                          |

## Agglomerate File Mapping Skeleton

The following binding only works in skeleton/hybrid annotations and if an agglomerate file mapping is activated.

| Key Binding                     | Operation                                 |
| ------------------------------- | ----------------------------------------- |
| ++shift++ + Middle Click        | Import Skeleton for Selected Segment      |

This video demonstrates an annotation workflow using some keyboard shortcuts:
![youtube-video](https://www.youtube.com/embed/KU8kf5mUTOI)

## Classic Controls

Note that you can enable *Classic Controls* in the left sidebar. 
Classic controls are provided for backward compatibility for long-time users and are not recommended for new user accounts.
Hence, Classic controls are disabled by default, and WEBKNOSSOS uses a more intuitive behavior which assigns the most important functionality to the left mouse button (e.g., moving around, selecting/creating/moving nodes). The right mouse button always opens a context-sensitive menu for more complex actions, such as merging two trees.
With classic controls, several mouse controls are modifier-driven and may also use the right-click for actions, such as erasing volume data.

