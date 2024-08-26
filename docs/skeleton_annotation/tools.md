# Skeleton Annotation Tools

TODO

- `Skeleton`: Create skeleton annotations and place nodes with a left mouse click. Read more below.

When the `Skeleton` tool is active, the following modifiers become available:

- `Create new Tree`: Creates a new tree.
- `Toggle single node tree mode`: This modifier makes the skeleton annotation tool create a new tree for each node instead of adding nodes to the current tree. You can use this mode to mark single objects or seeds, such as nuclei. This is also known as "Soma-clicking mode".
- `Toggle merger mode`: This modifier activates the `Merger Mode` for the skeleton annotation tool. In merger mode, you can use skeletons to "collect" and merge volume segments from an over-segmentation. [Read more about `Merger Mode`](./volume_annotation.md#proof_reading_and_merging_segments).

![Skeleton Tool modifiers](../images/skeleton_tool_modifiers.jpeg)

## Controls & Keyboard Shortcuts for Skeleton Annotations

While most operations for working with skeleton annotations are either available through the UI or the context-sensitive right-click menu, some users prefer to use keyboard shortcuts to work very efficiently.

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

Note that you can enable _Classic Controls_ which will behave slightly different and more explicit for some mouse actions:

| Key Binding        | Operation                                                              |
| ------------------ | ---------------------------------------------------------------------- |
| Left Drag          | Move around                                                            |
| Right Click        | Create New Node                                                        |
| ++shift++ + Left Click | Select Node (Mark as Active Node)                                      |
| Left Drag          | Move the node under the cursor (unless _Classic Controls_ are enabled) |

A full list of keyboard shortcuts is [available here](../ui/keyboard_shortcuts.md).