# FAQ

## What is the quickest way to get started with WEBKNOSSOS?
Signing up for a free account [webknossos.org](https://webknossos.org) is the quickest way to get up and running. Create an account (a new organization is created automatically for you), upload your first dataset to work on, and invite co-workers and collaborators to help you with annotation and analysis.

## I am unsure if WEBKNOSSOS is for me or how to get started with my data
Please feel free to reach out to us for help. We are happy to help you get started with WEBKNOSSOS and can assist with dataset uploads and conversations as needed. Email us at [hello@webknossos.org](mailto:hello@webknossos.org).

We also provide intro calls to answer your questions or walk you through the platform. Don't hesitate to reach out.

## I have a very large dataset and need help annotating it
There are two options to help you with data annotation:

1. Invite collaborators to your WEBKNOSSOS organization, set up a project to work on, and assign them sub-volumes of your data for annotation. See the [page on tasks and projects for more info](./tasks_projects/tasks.md). 
2. We also offer professional services to help with annotation. We can do both [manual annotations](https://webknossos.org/services/annotations) for your data or apply [automated segmentations](https://webknossos.org/services/automated-segmentation) on large-scale datasets.

## Where can I ask questions or report issues on WEBKNOSSOS?

We are always happy to help you through email or a quick call. In addition, we offer a community support forum for questions, bug reports, product updates, and community engagement. Visit us at [https://forum.image.sc/tag/webknossos](https://forum.image.sc/tag/webknossos).

## How can I run machine learning analysis on my datasets with WEBKNOSSOS?
Machine learning integration with WEBKNOSSOS is a very interesting topic for us and something that we want to focus more on. 
At the moment, there is a trial integration of a neural network model for neuron segmentation in EM brain data. 
We are looking to expand the model portfolio and integrated analysis. [Read more about automated analysis.](./automation/index.md)
We have years of experience with automated machine learning analysis and [offer commercial automated analysis services](https://webknossos.org/services/automated-segmentation). 

We are also always interested in new collaborations. 
Get in touch if you want to work together on a project resulting in new classifiers.

WEBKNOSSOS does not allow you to run custom machine learning models on your data yet. As a work-around you can download your annotations from WEBKNOSSOS - either manually or scripted [through our Python library](https://docs.webknossos.org/webknossos-py) - and do your ML analysis offline and use WEBKNOSSOS to inspect the results. 

## How can I use my dataset with WEBKNOSSOS?

WEBKNOSSOS supports [WKW (optimized), OME-Zarr (NGFF), Neuroglancer Precomputed, N5, KNOSSOS cubes](./data/index.md), and image stacks (converted on upload). You can also connect to Neuroglancer Precomputed, N5, and Zarr datasets hosted in the cloud (Google Cloud Storage, AWS S3).

Smaller datasets (up to multiple GB) can be uploaded directly through the web interface. For larger datasets, we recommend converting them to the standard WKW format using the [WEBKNOSSOS CLI](https://docs.webknossos.org/cli) CLI tool and uploading it via the [WEBKNOSSOS Python package](https://docs.webknossos.org/webknossos-py/examples/upload_image_data.html).

## Can I host the WEBKNOSSOS data in my own compute cluster (on-premise installation)?

WEBKNOSSOS consists of two components that allow for versatile deployment options:

1. The WEBKNOSSOS main component handles user and task management.
2. The datastore component serves data requests and stores skeleton and volume annotations.

By default, the datastore is integrated into the main component, and they run on the same machine.
However, multiple datastores may be connected to a single WEBKNOSSOS instance, and hence data can be streamed from a different storage location, e.g., your university's data center and dedicated workstation in your lab.
Both components need to be publicly accessible via the Internet.

For example, the WEBKNOSSOS main component could be hosted on commercial cloud infrastructure whereas the datastore is hosted directly in your lab's cluster hardware.

[Contact us](mailto:hello@webknossos.org) for commercial support, more information on (private) managed hosting, and custom deployment options.

## Can I further analyze my annotations outside of WEBKNOSSOS with Python/MATLAB?
Yes, you can. WEBKNOSSOS allows the download and export of skeleton annotations as NML files and segmentations/volume data as binary/wkw files.

Use our free [Python library](https://docs.webknossos.org/webknossos-py) to work with the WEBKNOSSOS standard formats.

## Newly registered users don't show up

New user registrations need to be approved by the respective admin of your WEBKNOSSOS instance.

Please go to the User list screen in the admin section.
Deactivate the `Show Active Users Only` option above the User table.