# Getting Started

Welcome to the WEBKNOSSOS documentation.
WEBKNOSSOS is a platform for [exploring large-scale 3D image datasets](./tracing_ui.md), [creating skeleton annotations](./skeleton_annotation.md) and [3D volume segmentations](./volume_annotation.md).
Since it is a web-based tool, [collaboration](./sharing.md), [crowdsourcing](./tasks.md) and [publication](https://webknossos.org) is very easy.

Feel free to [contact us](mailto:hello@webknossos.org) or [create a Pull Request](https://github.com/scalableminds/webknossos/pulls) if you have any suggestions for improving the documentation.

![type:video](https://www.youtube.com/watch?v=jsz0tc3tuKI)

## Create a webknossos.org Account

Signing up for a free account on [webknossos.org](https://webknossos.org) is the easiest and fastest way to get started with WEBKNOSSOS.
Either upload one of your own datasets and explore one of the many community datasets.

The free tier comes with 10GB of storage for private datasets.
For more data storage, check out the [pricing page for paid plans](https://webknossos.org/pricing) that covers storage costs and provides support services such as dataset conversions.

If you are looking for on-premise hosting at your institute or custom solutions, [please reach out to us](mailto:hello@webknossos.org).

## Explore Published Datasets

[webknossos.org](https://webknossos.org) comes with a large number of published community datasets available for you to explore.
To get started, navigate to the `Featured Publications` tab on your [dashboard](./dashboard.md).
There, you find a list of all available public datasets.
Click on the dataset name to open the dataset.

![The list of available datasets](./images/getting_started-datasets.jpeg)

Any WEBKNOSSOS dataset can be opened for read-only viewing ("View" mode) or in editor-mode to create a new skeleton and/or volume annotation.
The main WEBKNOSSOS user interface consists of three orthogonal viewports slicing the data along the major axis and a 3D viewport. Read more about the UI in the section [about the UI](./tracing_ui.md).

![The WEBKNOSSOS user interface consisting of three orthogonal viewports slicing the data along the major axis and a 3D viewport.](./images/main_ui.jpeg)

You can use the following shortcuts to navigate the data.
See the full list of [gestures and keyboard shortcuts](./keyboard_shortcuts.md) for advanced use.

| Shortcut                      | Operation                    |
| ----------------------------- | ---------------------------- |
| Left Mouse Drag or Arrow Keys | Move In-Plane                |
| SPACE or Mousewheel           | Move Forward                 |
| SHIFT + SPACE or Mousewheel   | Move Backward                |
| I or ALT + Mousewheel         | Zoom In                      |
| O or ALT + Mousewheel         | Zoom Out                     |
| Scroll Mousewheel (3D View)   | Zoom In And Out              |
| Right Click Drag (3D View)    | Rotate 3D View               |
| . (Dot)                       | Toggle Viewport Maximization |

You can also change the size of the viewports to see more details in your data and customize your layout.

![Explore datasets with customized viewport layouts](./images/getting_started-viewports.jpeg)

## Your First Annotation

Click the `Create Annotation` button while in "View" mode to create your first annotation.
WEBKNOSSOS will launch the main annotation screen allowing you to navigate your dataset, place markers to reconstruct skeletons, or annotate segments as volume annotations.

Depending on the current tool - selectable in the top bar - various actions can be performed.
Note that the most important controls are always shown in the status bar at the bottom of your screen.
The first tool is the _Move_ tool which allows navigating the dataset by moving the mouse while holding the left mouse button.
With the _Skeleton_ tool, a left mouse click can be used to place markers in the data, called nodes.
Additionally, the left mouse button can also be used to navigate around, select or drag nodes.
The _Brush_ and _Trace_ tools allow to "paint" voxels to create volumetric annotations.
For a full rundown on the other annotations tools, such as _Eraser_, _Segment Picker_, _Fill_ please refer to documentation on [skeleton](./skeleton_annotation.md) and [volume](./volume_annotation.md) annotations.

A right mouse click can be used to open a context-sensitive menu with various actions, such as merging two trees or flood-filling a segment.
Basic movement along the 3rd axis is done with the mouse wheel or by pressing the spacebar keyboard shortcut.

Learn more about the skeleton, volume, and hybrid annotations as well as the interface in the [Annotation UI guide](./tracing_ui.md).

![Editing skeleton and volume annotations in the Annotation UI](./images/tracing_ui.jpeg)

## Learn More

Now you know the basics of WEBKNOSSOS.
Feel free to explore more features of WEBKNOSSOS in this documentation.

- [Dashboard](./dashboard.md)
- [Skeleton Annotations](./skeleton_annotation.md)
- [Volume Annotations & Proof-Reading](./volume_annotation.md)
- [Keyboard Shortcuts](./keyboard_shortcuts.md)
- [Understanding the User Interface](./tracing_ui.md)
- [Sharing](./sharing.md)
- [Datasets](./datasets.md) and [Data Formats](./data_formats.md)
- [User and Permission Management](./users.md)
- [Task and Project Management](./tasks.md)
- [FAQ](./faq.md)

If you need help with WEBKNOSSOS, feel free to contact us at [hello@webknossos.org](mailto:hello@webknossos.org) or [write a post in the forum](https://forum.image.sc/tag/webknossos).
scalable minds also offers [commercial support, managed hosting, and feature development services](https://webknossos.org/pricing).

[Read the installation tutorial](./installation.md) if you wish to install WEBKNOSSOS on your server.
