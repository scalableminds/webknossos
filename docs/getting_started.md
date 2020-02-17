# Getting Started

Welcome to the webKnossos documentation.
webKnossos is a tool for [exploring large-scale 3D image datasets](./tracing_ui.md), [creating skeleton annotations](./skeleton_annotation.md) and [3D volume segmentations](./volume_annotation.md).
Since it is a web-based tool, [collaboration](./sharing.md), [crowdsourcing](./tasks.md) and [publication](https://webknossos.org) is very easy.

Feel free to [drop us a line](mailto:hello@scalableminds.com) or [create a Pull Request](https://github.com/scalableminds/webknossos/pulls) if you have any suggestions for improving the documentation.

{% embed url="https://www.youtube.com/watch?v=tNwDvo5MnDc "%}

## Create a webknossos.org Account
Signing up to [webknossos.org](https://webknossos.org) is the easiest way to get started with webKnossos.
Go to [webknossos.org](https://webknossos.org) and create an account in the "Demo_Lab" organization.
Please make sure to enter a correct email address.
After you have entered your details, the account will be automatically activated.

You can also choose to create a new organization which will allow you to upload private datasets at a later point in time and manage other users.
For testing purposes, the "Demo_Lab" organization is preferred.

Accounts on [webknossos.org](https://webknossos.org) are free to use with published datasets.
If you wish to use private datasets, there is a fee that covers storage costs and also provides support services such as dataset conversions.
Check out the [pricing page for more details](https://webknossos.org/pricing).
You can also rent a fully-managed dedicated webKnossos server from scalable minds or install webKnossos on your own server.


## Explore Published Datasets
On [webknossos.org](https://webknossos.org) there are already a bunch of published community datasets available for you to explore.
To get started, navigate to the `Datasets` tab on your [dashboard](./dashboard.md).
There, you find a list of all available datasets.
Click on the dataset name to open the dataset.

![The list of available datasets](./images/getting_started-datasets.png)

Once you are in the view mode, you are presented with three orthongonal views and one 3D viewport.
You can use the following shortcuts to navigate the data.
See the full list of [gestures and keyboard shortcuts](./keyboard_shortcuts.md) for advanced use.

| Shortcut                      | Operation                       |
| ----------------------------- | ------------------------------- |
| Left Mouse Drag or Arrow Keys | Move In-Plane                   |
| SPACE or Mousewheel           | Move Forward                    |
| SHIFT + SPACE or Mousewheel   | Move Backward                   |
| I or ALT + Mousewheel         | Zoom In                         |
| O or ALT + Mousewheel         | Zoom Out                        |
| Scroll Mousewheel (3D View)   | Zoom In And Out                 |
| Right Click Drag (3D View)    | Rotate 3D View                  |
| . (Dot)                       | Toggle Viewport Maximization    |

You can also change the size of the viewports to see more details in your data and customize your layout.

![Explore datasets with customized viewport layouts](./images/getting_started-viewports.png)


## Your First Annotation
Click the `Create Tracing` button from the view mode of a dataset to create your first annotation.
Alternatively, navigate to the `Datasets` tab on your [dashboard](./dashboard.md), identify a dataset that your interested in and click on `Start Skeleton Tracing` to create a new skeleton annotation.
webKnossos will launch the main annotation screen allowing you to navigate your dataset and place markers to reconstruct skeletons.

Drag the mouse while pressing the left mouse button to navigate the dataset.
Right-click in the data to place markers, called nodes.
Basic movement in the dataset is done with the mouse wheel or by pressing the spacebar keyboard shortcut.

Learn more about the skeleton, volume, and hybrid annotations as well as the interface in the [Tracing UI guide](./tracing_ui.md).

![Editing skeleton and volume annotations in the Tracing UI](./images/tracing_ui.png)


## Learn More
Now you know the basics of webKnossos.
Feel free to explore more features of webKnossos in this documentation.

* [Dashboard](./dashboard.md)
* [Skeleton Annotations](./skeleton_annotation.md)
* [Volume Annotations & Proof-Reading](./volume_annotation.md)
* [Keyboard Shortcuts](./keyboard_shortcuts.md)
* [Understanding the User Interface](./tracing_ui.md)
* [Sharing](./sharing.md)
* [Datasets](./datasets.md) and [Data Formats](./data_formats.md)
* [User and Permission Management](./users.md)
* [Task and Project Management](./tasks.md)
* [FAQ](./faq.md)

If you need help with webKnossos, feel free to send contact us at [hello@scalableminds.com](mailto:hello@scalableminds.com).
[scalable minds](https://scalableminds.com) also offers commercial support, managed hosting and feature development services.

[Read the installation tutorial](./installation.md), if you wish to install webKnossos on your own server.
