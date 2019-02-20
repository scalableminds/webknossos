# Getting Started

Welcome to the webKnossos documentation. Feel free to [drop us a line](mailto:hello@scalableminds.com) or [create a Pull Request](https://github.com/scalableminds/webknossos/pulls) if you have any suggestions for improving the documentation.

## Try webKnossos

We host a public instance of webKnossos for trial purposes at [https://try.webknossos.org](https://try.webknossos.org). Visit the page and create your organization to get started. The trial is limited to 2 months of use. If you would like to continue using webKnossos, we offer managed hosting plans for uninterrupted service.

## Installation on Your Own Server

webKnossos is open-source, so you can install it on your own server. We recommend a server with at least 4 CPU cores, 16 GB RAM, and as much disk space as you require for your datasets. As prerequisites, you need to install [Git](https://git-scm.com/), [Docker](https://docs.docker.com/install/) and [Docker Compose](https://docs.docker.com/compose/install/) on your server.

To get started, simply clone the Git repository and start the docker containers:

```bash
git clone https://github.com/scalableminds/webknossos.git
cd webknossos

docker-compose pull webknossos
./start-docker.sh
```

This will start an instance of webKnossos on [http://localhost:9000/](http://localhost:9000/). Open the URL in your browser and configure your organization. This will create a folder for your data at `webknossos/binaryData/<organization name>`.

{% hint style="info" %}
For production setups, we recommend more elaborate configurations with a public domain name and HTTPS support. [Please contact us](mailto:hello@scalableminds.com) if you require any assistance with your production setup.
{% endhint %}

You may also install webKnossos without Docker. This may be useful if you intend to develop features for webKnossos. Please refer to the [Code Readme](reference/readme.md) for details.

## Onboarding

When starting with webKnossos you first need to create an organization. An organization represents your lab in webKnossos and handles permissions for users and datasets. Choose a descriptive name for your organization, e.g. "The University of Springfield", "Simpsons Lab" or "Neuroscience Department".

![Create your organization](.gitbook/assets/onboarding_organization%20%281%29.png)

In the onboarding flow, you are asked to create a user account for yourself. This will be the first user of your organization which will automatically be activated and granted admin rights. Make sure to enter a correct email address.

![Create your first user](.gitbook/assets/onboarding_user%20%282%29.png)

## Your First Dataset

Now that you've completed the onboarding, you need to import a dataset. Without any data, webKnossos is not fun.

For small datasets \(max. 1GB\), you can use the upload functionality provide in the web interface. For larger datasets, we recommend the file system upload. Read more about the import functionality in the [Datasets guide](guides/datasets.md).

If you do not have a compatible dataset available, you can use [this small dataset excerpt \(300 MB\)](https://static.webknossos.org/data/e2006_wkw.zip) for testing purposes. The data was published by [Helmstaedter et al., 2011](https://www.nature.com/articles/nn.2868).

By default, datasets are visible to all users in your organization. However, webKnossos includes fine-grained permissions to assign datasets to groups of users.

![Upload your first dataset](.gitbook/assets/onboarding_data1%20%283%29.png) ![Confirm the dataset properties](.gitbook/assets/onboarding_data2.png)

## Your First Annotation

To get started with your first annotation, navigate to the `Datasets` tab on your [dashboard](guides/dashboard.md). Identify a dataset that your interested in and click on `Start Skeleton Tracing` to create a new skeleton annotation. webKnossos will launch the main annotation screen allowing you to navigate your dataset and place markers to reconstruct skeletons.

Drag the mouse while pressing the left mouse button to navigate the dataset. Right-click in the data to place markers, called nodes. Basic movement in the dataset is done with the mouse wheel or by pressing the spacebar keyboard shortcut.

Learn more about the skeleton, volume, and hybrid annotations as well as the interface in the [Tracing UI guide](guides/tracing_ui.md).

{% embed url="https://www.youtube.com/embed/rMMaItS\_HYE" caption="" %}

## Learn more

Now you know the basics of webKnossos. Feel free to explore more features of webKnossos in this documentation.

* [Dashboard](guides/dashboard.md)
* [Keyboard Shortcuts](reference/keyboard_shortcuts.md)
* [Tracing UI](guides/tracing_ui.md)
* [Sharing](guides/sharing.md)
* [Datasets](guides/datasets.md) and [Data Formats](reference/data_formats.md)
* [User and Permission Management](guides/users.md)
* [Task and Project Management](guides/tasks.md)
* [FAQ](reference/faq.md)

If you need help with webKnossos, there is a [Community Support forum](https://support.webknososs.org) where members of the community and scalable minds are happy to answer your questions. [scalable minds](https://scalableminds.com) also offers commercial support, managed hosting and feature development services. [Please contact us](mailto:hello@scalableminds.com) if you want to learn more.

