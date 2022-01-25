# FAQ

## What is the quickest way to get started with webKnossos
Signing up for a free account [webKnossos.org](https://webknossos.org) is the quickest way to get up and running. Create an account and organization, upload your first dataset to work on and invite co-workers and collaborators to help you with annotation and analysis.

## I am unsure if webKnossos is for me or how to get started with my data
Please feel free to reach out to us for help. We are happy to help you get started with webKnossos and can assist with dataset uploads and conversations as needed. Email us at [hello@webknossos.org](mailto:hello@webknossos.org) .

We also provide intro calls to answer your questions or walk you through the platform. Don't hesitate to reach out.

## I have a very large dataset and need help annotating it
There are two options to help you with data annotation:
1. Invite collaborators to your webKnossos organization and assign them sub-volumes of your data for annotation. See the [page on Collaboration for more info](./sharing.md). 

2. We also offer professional service to help with annotation. We can do both [manual annotations](https://webknossos.org/services/annotations) for your data or apply [automated segmentations](https://webknossos.org/services/automated-segmentation) on large-scale datasets.

## Where can I ask question or report issues on webKnossos.

We are always happy to help you through email or a quick call. In addition we offer a community support forum for questions, bug reports, product updates and community engagment. Visit us at [https://forum.image.sc/tag/webknossos](https://forum.image.sc/tag/webknossos).

## How can I run machine learning analysis on my datasets with webKnossos?
Machine learning integration with webKnossos is a very interesting topic for us and something that we want to focus more on. 
At the moment, there is a trial integration of a neural network model for nuclei segmentation in EM brain data. 
We are looking to expand the model portfolio and integrated analysis. 
We have a lot of know how for automated machine learning analysis and [offer commercial automated analysis services](https://webknossos.org/services/automated-segmentation). 

We are also always interested in new collaborations. 
Get in touch if you want to work together on a project resulting in new classfiers.

webKnossos does not allow you to run custom machine learning model on your data yet. As a workaround you can download your annotations from webKnossos - either manually or scripted [through our Python libarary](./tooling.md) - and do you ML analysis offline and use webKnossos to inspect the results. 

## How Can I Use My Dataset With webKnossos

webKnossos supports WKW (Optimized), KNOSSOS cubes](./data_formats.md), and image stacks (converted on upload). You can also connected to [Neuroglancer Precomputed dataset hosted in the Google Cloud and to data hosted by a BossDB](https://github.com/scalableminds/webknossos-connect).

Smaller dataset can be uploaded directly through the web interface. For larger dataset, we recommend to convert them to the standard WKW format using the [webKnossos Cuber](https://docs.webknossos.org/wkcuber/index.html) CLI tool.

## Can I Host the webKnossos Data in My Own Compute Cluster (on-premise installation)

webKnossos consists of two components that allow for versatile deployment options:
1. The webKnossos main component handles user and task management.
2. The datastore component serves data requests and stores skeleton and volume annotations.

By default, the datastore is integrated into the main component and they run on the same machine.
However, multiple datastores may be connected to a single webKnossos instance and hence data can be streamed from different storage location, e.g. your university's data center and dedicated workstation in your lab.
Both components need to be publicly accessible via the Internet.

For example, the webKnossos main component could be hosted on commercial cloud infrastructure whereas the datastore is hosted directly in your lab's cluster hardware.

[Contact us](mailto:hello@webknossos.org) for commercial support, more information on (private) managed hosting, and custom deployment options.

## Can I further analyze my annotations outside of webKnossos with Python/MATLAB?
Yes, you can. webKnossos allows the download and export of skeleton annotations as NML files and segmentations/volume data as binary/wkw files.

See the [Tooling](./tooling.md) section for a recommendation of Python/MATLAB libraries to work with the webKnossos standard formats.

## Newly Registered Users Don't Show Up

New user registration need to be approved by the respective admin of your webKnossos instance.

Please go to the User list screen in the admin section.
Deactivate the `Show Active Users Only` option above the User table.