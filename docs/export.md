# Data Export and Interoperability

We believe in using the best tool for the job and webKnossos makes it easy to download and export any annotation for further processing in third-party software.

## Data Export through Zarr Streaming 

Any dataset and volume annotation in webKnossos can also be accessed by third-party software through the Zarr streaming interface. In other words, webKnossos is a fully, capable server for streaming data according to the Zarr spec to any client and can be viewed as an alternative to cloud storage options such as S3/Google Cloud. 
As an additional benefit, you still retain all the other helpful webKnossos features for managing, searching, tagging, and securing datasets adhering to the FAIR (Findability, Accessibility, Interoperability, and Reuse of digital assets) principles.

Any webKnossos dataset/annotation can be accessed this way regardless of its original file format. webKnossos will automatically convert any data on the fly.

To access and share a dataset through Zarr streaming, follow these steps:

1. Click on the overflow menu (dropdown), next to the `Save` button in the webKnossos navbar
2. Select `Zarr Links` entry
3. Click `Create Zarr Link` to make the resource available through the Zarr streaming interface. Set the `Expiration Date` as required. The default duration is 1 month into the future.
4. Click on the little copy button (clipboard icon) to copy the Zarr web link. Due to the nature of the Zarr spec, if you need to individually copy a URL for each webKnossos layer.

![The Zarr Link dialog for sharing a dataset/annotation as a Zarr source for streaming to third-party services.](images/zarr_links.jpeg)

A unique aspect of webKnossos is private Zarr links. Any annotation shared through Zarr generates a web link containing a unique access token for authentication such that only allowed users and collaborators may access this data. This is akin to webKnossos ability to [privately share annotations through web URLs](./sharing.md#annotation-sharing). Zarr links can be revoked/deleted at any time (or time-limited by default) to retain control over your data.

## Data Export through the UI

The webKnossos UI comes with a fully featured `Download` panel offering a wide variety of download export options:

- Export any layer as Tif stack triggering a [long-running job](./jobs.md)
- Download skeleton annotation as [NML files](./data_formats.md#nml-files)
- Download volume annotations as [WKW files](./data_formats.md#wkw-datasets)
- Instructions for using the webKnossos Python library for download (see below)

To access the download panel:

1. Click on the overflow menu (dropdown), next to the `Save` button in the webKnossos navbar
2. Select `Download` entry
3. Select the desired data for download or export 

![The "Download" dialog for exporting and downloading annotations and dataset layers. WebKnossos offers downloads as Tif stacks, the native webKnossos file formats, and through the Python library.](images/download_dialog.gif)

## Data Export through Python

The [webKnossos Python library](https://docs.webknossos.org/webknossos-py/index.html) makes it very easy to download/upload any of your organization's datasets, and annotations. For detailed info, please refer to the `webKnossos-libs` [documentation website for guides and tutorials](https://docs.webknossos.org/webknossos-py/index.html).

There are also quick start instructions for Python download available directly from the webKnossos UI ([see above](./export.md#data-export-through-the-ui)).