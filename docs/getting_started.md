# Getting Started

Welcome to the webKnossos documentation.
Feel free to [drop us a line](mailto:hello@scalableminds.com) or [create a Pull Request](https://github.com/scalableminds/webknossos/pulls) if you have any suggestions for improving the documentation.

https://www.youtube.com/watch?v=tNwDvo5MnDc 


## Try webKnossos
We host a public instance of webKnossos for trial purposes at https://try.webknossos.org.
Visit the page and create your organization to get started.
The trial is limited to 2 months of use.
If you would like to continue using webKnossos, we offer managed hosting plans for uninterrupted service.

## Installation on Your Own Server
webKnossos is open-source, so you can install it on your own server.
We recommend a server with at least 4 CPU cores, 16 GB RAM, and as much disk space as you require for your datasets.
As prerequisites, you need to install [Git](https://git-scm.com/), [Docker](https://docs.docker.com/install/) and [Docker Compose](https://docs.docker.com/compose/install/) on your server.

To get started, simply clone the Git repository and start the docker containers:

```bash
git clone https://github.com/scalableminds/webknossos.git
cd webknossos

docker-compose pull webknossos
./start-docker.sh
```

This will start an instance of webKnossos on http://localhost:9000/.
Open the URL in your browser and configure your organization.
This will create a folder for your data at `webknossos/binaryData/<organization name>`.

{% hint style='info' %}
For production setups, we recommend more elaborate configurations with a public domain name and HTTPS support.
[Please contact us](mailto:hello@scalableminds.com) if you require any assistance with your production setup.
{% endhint %}

You may also install webKnossos without Docker.
This may be useful if you intend to develop features for webKnossos.
Please refer to the [Code Readme](../README.md) for details.


## Onboarding
When starting with webKnossos you first need to create an organization.
An organization represents your lab in webKnossos and handles permissions for users and datasets.
Choose a descriptive name for your organization, e.g. "The University of Springfield", "Simpsons Lab" or "Neuroscience Department".

![Create your organization](./images/onboarding_organization.png)

In the onboarding flow, you are asked to create a user account for yourself.
This will be the first user of your organization which will automatically be activated and granted admin rights.
Make sure to enter a correct email address.

![Create your first user](./images/onboarding_user.png)

## Your First Dataset
Now that you've completed the onboarding, you need to import a dataset.
Without any data, webKnossos is not fun.

For small datasets (max. 1GB), you can use the upload functionality provide in the web interface.
For larger datasets, we recommend the file system upload.
Read more about the import functionality in the [Datasets guide](./datasets.md).

If you do not have a compatible dataset available, you can use one of the [sample datasets](./datasets.md#sample-datasets) for testing purposes.

By default, datasets are visible to all users in your organization.
However, webKnossos includes fine-grained permissions to assign datasets to groups of users.

![Upload your first dataset](./images/onboarding_data1.png)
![Confirm the dataset properties](./images/onboarding_data2.png)


## Your First Annotation
To get started with your first annotation, navigate to the `Datasets` tab on your [dashboard](./dashboard.md).
Identify a dataset that your interested in and click on `Start Skeleton Tracing` to create a new skeleton annotation.
webKnossos will launch the main annotation screen allowing you to navigate your dataset and place markers to reconstruct skeletons.

Drag the mouse while pressing the left mouse button to navigate the dataset.
Right-click in the data to place markers, called nodes.
Basic movement in the dataset is done with the mouse wheel or by pressing the spacebar keyboard shortcut.

Learn more about the skeleton, volume, and hybrid annotations as well as the interface in the [Tracing UI guide](./tracing_ui.md).

{% embed data="{\"url\":\"https://www.youtube.com/embed/rMMaItS\_HYE\",\"type\":\"video\",\"title\":\"webKnossos Tracing UI Skeleton\",\"icon\":{\"type\":\"icon\",\"url\":\"https://www.youtube.com/yts/img/favicon\_144-vfliLAfaB.png\",\"width\":144,\"height\":144,\"aspectRatio\":1},\"thumbnail\":{\"type\":\"thumbnail\",\"url\":\"https://i.ytimg.com/vi/rMMaItS\_HYE/mqdefault.jpg\",\"width\":320,\"height\":180,\"aspectRatio\":0.5625},\"embed\":{\"type\":\"player\",\"url\":\"https://www.youtube.com/embed/rMMaItS\_HYE?rel=0&showinfo=0\",\"html\":\"<div style=\\\"left: 0; width: 100%; height: 0; position: relative; padding-bottom: 56.2493%;\\\"><iframe src=\\\"https://www.youtube.com/embed/rMMaItS\_HYE?rel=0&amp;showinfo=0\\\" style=\\\"border: 0; top: 0; left: 0; width: 100%; height: 100%; position: absolute;\\\" allowfullscreen scrolling=\\\"no\\\"></iframe></div>\",\"aspectRatio\":1.7778}}" %}


## Learn more
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

If you need help with webKnossos, there is a [Community Support forum](https://support.webknososs.org) where members of the community and scalable minds are happy to answer your questions.
[scalable minds](https://scalableminds.com) also offers commercial support, managed hosting and feature development services.
[Please contact us](mailto:hello@scalableminds.com) if you want to learn more.

