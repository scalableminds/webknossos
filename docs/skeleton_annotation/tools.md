# Skeleton Annotation Tools

Skeleton annotation in WEBKNOSSOS allows you to create graph-like structures by placing connected nodes in 3D space. This is particularly useful for tracing neurons and other branching structures.

![New Tree Modifier](../ui/images/skeleton-tool.jpg){align=left width="60"} 
The **Skeleton tool** enables you to create and edit skeleton annotations:

- Place nodes with precise positioning
- Connect nodes to form tree structures
- Add branches and create complex neural tracings

## Basic Concepts

A skeleton annotation consists of:

- **Nodes**: Individual points placed in 3D space (created with left-click)
- **Edges**: Connections between nodes that form trees
- **Trees**: Collections of connected nodes and edges
- **Branch Points**: Special nodes marking where a structure splits into multiple paths

The active node is always highlighted with a circle and can be moved by dragging.


## Creating Annotations

### New Trees
- Select the **Skeleton** tool from the toolbar
- Create a new tree using the toolbar button or press ++c++
- Each tree can represent a different structure or part of your annotation
- Trees are listed and can be managed in the [right sidebar](trees_list.md)

### Branch Points
- Mark any node as a branch point using ++b++ or the right-click menu
- Branch points are highlighted with a distinct color
- All branch points are stored in a first-in, first-out (FIFO) stack
- Jump to the latest branch point using ++j++ to continue working from there

### Tool Modifiers

The following modifiers are available for the skeleton tool:

![New Tree Modifier](./images/new-tree-modifier.jpg){align=left width="60"} 
**Create new Tree**

- Starts a fresh tree structure
- Useful when annotating multiple separate structures

![Single Node Tree Mode Modifier](./images/single-node-tree-mode-modifier.jpg){align=left width="60"} 
**Single Node Tree Mode**

- Creates a new tree for each placed node
- Perfect for marking individual objects (e.g., cell nuclei)
- Also known as "Soma-clicking mode"

![Merger Mode Modifier](./images/merger-mode-modifier.jpg){align=left width="60"} 
**Merger Mode**

- Enables using skeletons to merge volume segments
- Useful for correcting over-segmentation
- Learn more about [Merger Mode](../proofreading/merger_mode.md)

## Skeleton Keyboard Shortcuts 

The following common keyboard shortcuts are handy for speeding up your annotation workflow:

| Key Binding | Operation                                          |
| ----------- | -------------------------------------------------- |
| Left Click  | Create New Node                                    |
| Left Click  | Select Node (Mark as Active Node) under the cursor |
| Left Drag   | Move around                                        |
| Left Drag   | Move the node under the cursor                     |
| ++s++           | Center Camera on Active Node                       |
| ++del++         | Delete Active Node                                 |
| ++b++           | Create Branch Point                                |
| ++j++           | Jump to Last Branch Point                          |
| ++c++           | Create New Tree                                    |

!!! tip "Keyboard Shortcuts"
    For faster workflow, refer to the [keyboard shortcuts](../ui/keyboard_shortcuts.md) guide.