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

## First Time Onboarding
- explaing onboarding wizard

## First Dataset
- how can i load my first dataset?
- short excurse about permissions for users / datasets

## First Tracing
- how do i start my first tracing

## Advanced Setups

webKnossos consists of two components that allow for versatile deployment options:
1. The webKnossos main component handles user and task management.
2. The datastore component serves data requests and stores skeleton and volume annotations.

By default, the datastore is integrated into the main component.
Multiple datastores may be connected to a single webKnossos instance.
Both components need to be publicly accessible via the Internet.

For example, the webKnossos main component could be hosted on commercial cloud infrastructure whereas the datastore is hosted directly in your lab's cluster hardware.

scalable minds offers commercial support and managed hosting for custom deployment options.

## Navigationg The Dashboard
- see chapter dashboard
