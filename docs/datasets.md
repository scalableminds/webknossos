# Managing Datasets

3D image datasets are at the heart of webKnossos.
[Import datasets](#importing-datasets) via the file system or the upload feature.
[Configure the dataset](#edit-dataset) defaults and permissions to your specification.
[Share your datasets](./sharing.md#dataset-sharing) with the public or with selected users.

## Importing Datasets

### Uploading through the File System
To efficienty import large datasets, we recommend to place them directly in the file system:

* Place the dataset at `<webKnossos directory>/binaryData/<Organization name>/<Dataset name>`
* Go to the dataset view on the dashboard
* Use the refresh button on the dashboard or wait for webKnossos to detect the dataset (up to 10min)
* Click `Import` for your new dataset
* Follow the import wizard

### Uploading through the web browser
To quickly import a dataset, you may use the upload functionality from webKnossos.
This is only recommended for datasets up to 1 GB.

In order to upload the datasets, create a ZIP file that contains the WKW or KNOSSOS cubes in the folder structure as described in the [Data Formats guide](./data_formats.md).

### Importing in webKnossos

## Dataset Properties
- which are the most important properties
- explain the json stuff

## Edit Dataset
- Permissions
- Defaults

## Dataset Sharing
Read more in the [Sharing guide](./sharing.md#dataset-sharing)

## Using External Datastores
The system architecture of webKnossos allows for versatile deployment options where you can install a dedicated datastore server directly in your lab's cluster infrastructure.
This may be useful when dealing with large datasets that should remain in your data center.
[Please contact us](mailto:hello@scalableminds.com) if you require any assistance with your setup. 
