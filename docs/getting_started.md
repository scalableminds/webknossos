# Getting Started

Welcome to the webKnossos documentation.
Feel free to [drop us a line](mailto:hello@scalableminds.com) or [create a Pull Request](https://github.com/scalableminds/webknossos/pulls) if you have any suggestions for improving the documentation.

## Try webKnossos
We host a public instance of webKnossos for trial purposes at https://try.webknossos.org.
Visit the page and create your organization to get started.
The trial is limited to 2 months of use.
If you would like to continue using webKnossos, we offer managed hosting plans for uninterrupted service.

## Installation on Your Own Server
webKnossos is open-source, so you can install it on your own server.
We recommend at server with at least 4 CPU cores, 16 GB RAM and as much disk space as you require for your datasets.
As prerequisites, you need to install [Git](https://git-scm.com/), [Docker](https://docs.docker.com/install/) and [Docker Compose](https://docs.docker.com/compose/install/) on your server.

To get started, simply clone the Git repository and start the docker containers:

```bash
git clone https://github.com/scalableminds/webknossos.git
cd webknossos

docker-compose pull webknossos
docker-compose up webknossos
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
An organization respresents your lab in webKnossos and handles permissions for users and datasets.
Choose a descriptive name for your organization, e.g. "University of Springfield", "Simpsons Lab" or "Neuroscience Department".

![Create your organization](./images/onboarding_organization.png)

In the onboarding flow, you are asked to create a user account for yourself.
This will be the first user of your organisation which will automatically be activated and granted admin rights.
Make sure to enter a correct email address.

![Create your first user](./images/onboarding_user.png)

## Your First Dataset
Now that you've completed the onboarding, you need to import a dataset.
Without any data, webKnossos is not fun.

For small datasets (max. 1GB), you can use the upload functionality provide in the web interface.
For larger datasets, we recommend the file system upload.
Read more about the import functionality in the [Datasets guide](./datasets.md).

If you do not have a compatible dataset available, you can use [this small dataset excerpt (300 MB)](https://webknossos.org/data/e2006_wkw.zip) for testing purposes.
The data was published by [Helmstaedter et al., 2011](https://www.nature.com/articles/nn.2868).

By default, datasets are visible to all users in your organization.
However, webKnossos includes fine-grained permissions to assign datasets to groups of users.

![Upload your first dataset](./images/onboarding_data1.png)
![Confirm the dataset properties](./images/onboarding_data2.png)


## Your First Annotation
To get started with your first annotation, navigate to the `Datasets` tab on your [dashboard](./dashboard.md). 
Identify a dataset that your interested in and click on `Start Skeleton Tracing` to create a new skeleton annotation. 
webKnossos will launch the main annotation screen allowing you to navigate your dataset and place markers to reconstruct skeletons. 

Drag the mouse while pressing the left mouse button to navgiate the dataset. 
Right click in the data to place markers, called nodes. 
Basic movement in the dataset is done with mouse wheel or by pressing space bar keyboard shortcut.

Learn more about skeleton, volume, and hybrid annotations as well as the interface in the [Tracing UI guide](./tracing_ui.md).

[Create a new Annotation from the Dashboard](https://www.youtube.com/embed/rMMaItS_HYE)


## Learn more
Now you know the basics of webKnossos.
Feel free to explore more features of webKnossos in this documentation.

* [Dashboard](./dashboard.md)
* [Keyboard Shortcuts](./keyboard_shortcuts.md)
* [Tracing UI](./tracing_ui.md)
* [Sharing](./sharing.md)
* [Datasets](./datasets.md) and [Data Formats](./data_formats.md)
* [User and Permission Management](./users.md)
* [Task and Project Management](./tasks.md)
* [FAQ](./faq.md)

If you need help with webKnossos, there is a [Community Support forum](https://support.webknososs.org) where members of the community and scalable minds are happy to answer your questions.
[scalable minds](https://scalableminds.com) also offers commercial support, managed hosting and feature development services.
[Please contact us](mailto:hello@scalableminds.com) if you want to learn more.


## Advanced Setups

webKnossos consists of two components that allow for versatile deployment options:
1. The webKnossos main component handles user and task management.
2. The datastore component serves data requests and stores skeleton and volume annotations.

By default, the datastore is integrated into the main component.
Multiple datastores may be connected to a single webKnossos instance.
Both components need to be publicly accessible via the Internet.

For example, the webKnossos main component could be hosted on commercial cloud infrastructure whereas the datastore is hosted directly in your lab's cluster hardware.

[scalable minds](https://scalableminds.com) offers commercial support and managed hosting for custom deployment options.
