# Managing Datasets

Working with 3D (and 2D) image datasets is at the heart of webKnossos. 

- [Import datasets](#importing-datasets) by uploading them directly via the web UI or by using the file system (self-hosted instances only).
- [Configure the dataset](#configuring-datasets) defaults and permissions to your specification.
- [Share your datasets](./sharing.md#dataset-sharing) with the public or with selected users.

[Read the section on file and data formats](./data_formats.md) if you are interested in the technical background and concepts behind webKnossos datasets.

## Importing Datasets
webKnossos supports both loading data from a local hard disk or streaming it from a remote storage server or the cloud. In either case, webKnossos acts as the central hub to manage all your datasets in one place, search, and tag them. There are several ways to import and add a dataset to webKnossos:

### Uploading through the web browser
The easiest way to get started with working on your datasets is through the webKnossos web interface. You can directly upload your dataset through the browser.

1. From the *Datasets* tab in the user dashboard, click the *Add Dataset* button.
2. Provide some metadata information:
  - a *name* 
  - give access permissions for one or more teams (use the `default` team if all members of your organization should be able to see it)
  - *scale* of each voxel (in nanometers)
3. Drag and drop your data into the upload section
4. Click the *Upload* button


webKnossos uses the [WKW-format](./data_formats.md#wkw-datasets) internally to display your data.
If your data is already in WKW you can simply drag your folder (or zip archive of that folder) into the upload view.

If your data is not in WKW, you can either:

- upload the data in a supported file format and webKnossos will automatically convert it to WKW ([webknossos.org](https://webknossos.org) only). Depending on the size of the dataset, the conversion will take some time. You can check the progress at the "Jobs" page or the "Datasets" tab in the dashboard (both will update automatically).
- [Convert](#converting-datasets) your data manually to WKW.

In particular, the following file formats are supported for uploading (and conversion):

- [WKW dataset](#WKW-Datasets)
- [Image file sequence](#Single-Layer-Image-File-Sequence) in one folder (tif, jpg, png, dm3, dm4)
  - as an extension, multiple folders with image sequences are interpreted as [separate layers](#Multi-Layer-Image-File-Sequence)
- Single-file images (tif, czi, nifti, raw)
- KNOSSOS file hierarchy 
- [Read more about the supported file formats and details](./data_formats.md#conversion-with-webknossosorg)

Once the data is uploaded (and potentially converted), you can further configure a dataset's [Settings](#configuring-datasets) and double-check layer properties, finetune access rights & permissions, or set default values for rendering.

### Working with Zarr datasets
webKnossos supports loading and remotely streaming [Zarr](https://zarr.dev) datasets from a remote HTTP server or the cloud. webKnossos supports loading Zarr v2 datasets according to the [OME NGFF v0.4 spec](https://ngff.openmicroscopy.org/latest/).

webKnossos can load several Zarr sources and assemble them into a webKnossos dataset with several layers, e.g. one Zarr file/source for the `color` layer and one Zarr file/source for a `segmentation` layer.

1. From the *Datasets* tab in the user dashboard, click the *Add Dataset* button.
2. Select the *Add Remote Zarr Dataset*
3. For each layer, provide some metadata information:
  - a URL or domain/collection identifier to locate the dataset on the remote service
  - authentication credentials for accessing the resources on the remote service (optional)
4. Click the *Add Layer* button
5. webKnossos will automatically try to infer as many dataset properties (voxel size, bounding box, etc) as possible and preview a [webKnossos `datasource` configuration](./data_formats.md#dataset-metadata-specification) for your to review. 
  Consider setting the dataset `name` property and double-check all other properties for correctness.
6. Click `Import` to finish

webKnossos will NOT download/copy any data from these third-party data providers. 
Rather, any data viewed in webKnossos will be streamed read-only and directly from the remote source. 
Any other webKnossos feature, e.g., annotations, and access rights, will be stored in webKnossos and do not affect these services. 

Note that, data streaming may count against any usage limits or minutes as defined by these third-party services. Check with the service provider or dataset owner.

Hint: If happen to have any Zarr dataset locally that you would like to view in webKnossos, consider running an HTTP server locally to serve the dataset. Then webKnossos can easily stream the data.

### Working with Neuroglancer and BossDB datasets
On webKnossos.org supports loading and remotely streaming datasets in the [Neuroglancer precomputed format](https://github.com/google/neuroglancer/tree/master/src/neuroglancer/datasource/precomputed) stored in the Google Cloud or datasets served from [BossDB](https://bossdb.org).

To import these datasets:

1. From the *Datasets* tab in the user dashboard, click the *Add Dataset* button.
2. Select the *Add Neuroglancer Dataset* or *Add BossDB Dataset* tab
3. Provide some metadata information:
  - a *dataset name* 
  - a URL or domain/collection identifier to locate the dataset on the remote service
  - authentication credentials for accessing the resources on the remote service (optional)
4. Click the *Add* button

webKnossos will NOT download/copy any data from these third-party data providers. 
Rather, any data viewed in webKnossos will be streamed read-only and directly from the remote source. 
Any other webKnossos feature, e.g., annotations, and access rights, will be stored in webKnossos and do not affect these services. 

Note that data streaming may count against any usage limits or minutes as defined by these third-party services. Check with the service provider or dataset owner.

### Working with N5 datasets
We are working on integrating [N5](https://github.com/saalfeldlab/n5) support into webKnossos. If you have datasets in the N5 format and would like to work with us on building, testing, and refining the N5 integration into webKnossos then [please contact us](mailto:hello@webknossos.org).

### Uploading through the Python API
For those wishing to automate dataset upload or to do it programmatically, check out the webKnossos [Python library](https://github.com/scalableminds/webknossos-libs). It allows you to create, manage and upload datasets as well. 

### Uploading through the File System
-- (Self-Hosted Instances Only)-- 

On self-hosted instances, large datasets can be efficiently imported by placing them directly in the file system (WKW-format only):

* Place the dataset at `<webKnossos directory>/binaryData/<Organization name>/<Dataset name>`. For example `/opt/webknossos/binaryData/Springfield_University/great_dataset`.
* Go to the [dataset view on the dashboard](./dashboard.md)
* Use the refresh button on the dashboard or wait for webKnossos to detect the dataset (up to 10min)

Typically webKnossos can infer all the required metadata for a dataset automatically and import datasets automatically on refresh. In some cases, you will need to manually import a dataset and provide more information:
* On the dashboard, click *Import* for your new dataset
* Provided the requested properties, such as *scale* and *largestSegmentId*. See the section on [configuring datasets](#configuring-datasets) below for more detailed explanations of these parameters.

!!! info
    If you uploaded the dataset along with a `datasource-properties.json` metadata file, the dataset will be imported automatically without any additional manual steps.


#### Using Symbolic Links
-- Self-Hosted Instances Only --

When you have direct file system access, you can also use symbolic links to import your data into webKnossos. This might be useful when you want to create new datasets based on potentially very large raw microscopy data and symlink it to one or several segmentation layers.

Note, when using Docker, the targets of the link also need to be available to the container through mounts.

For example, you could have a link from `/opt/webknossos/binaryData/sample_organization/awesome_dataset` to `/cluster/path/to/dataset123`.
To make this dataset available to the Docker container, you need to add `/cluster` as another volume mount.
You can add this directly to the docker-compose.yml:

```yaml
...
services:
  webknossos:
    ...
    volumes:
      - ./data:/webknossos/binaryData
      - /cluster:/cluster
...
```

### Converting Datasets
Any dataset uploaded through the web interface at [webknossos.org](https://webknossos.org) is automatically converted for compatibility.

For manual conversion, we provide the following software tools and libraries:

- The [webKnossos Cuber](https://docs.webknossos.org/wkcuber/index.html) is a CLI tool that can convert many formats to WKW. 
- For other file formats, the [Python webKnossos library](https://docs.webknossos.org/webknossos-py/index.html) can be an option for custom scripting.

See the page on [software tooling](./tooling.md) for more.

## Configuring Datasets
You can configure the metadata, permission, and other properties of a dataset at any time. 

Note, any changes made to a dataset may influence the user experience of all users in your organization working with that dataset, e.g., removing access rights working, adding/removing layers, or setting default values for rendering the data.

To make changes, click on the "Settings" action next to a dataset in the "Datasets" tab of your dashboard.
Editing these settings requires your account to have enough access rights and permissions. [Read more about this.](./users.md)

### Data Tab
The *Data* tab contains the settings for correctly reading the dataset as the correct data type (e.g., `uint8`), setting up, and configuring any layers.

- `Scale`: The physical size of a voxel in nanometers, e.g., `11, 11, 24`

For each detected layer:

- `Bounding Box`: The position and extents of the dataset layer in voxel coordinates. The format is `x, y, z, x_size,y_size, z_size` or respectively `min_x, min_y, min_z, (max_x - min_x), (max_y - min_y), (max_z - min_z)`.
- `Largest Segment ID`: The highest ID that is currently used in the respective segmentation layer. This is required for volume annotations where new objects with incrementing IDs are created. Only applies to segmentation layers.

The `Advanced` view lets you edit the underlying [JSON configuration](./data_formats.md#wkw-metadata-by-example) directly. Toggle between the `Advanced` and `Simple` page in the upper right. Advanced mode is only recommended for low-level access to dataset properties and users familiar with the `datasource-properties.json` format.

webKnossos automatically periodically checks and detects changes to a dataset's metadata (`datasource-properties.json`) on disk (only relevant for self-hosted instances). Before applying these suggestions, users can preview all the new settings (as JSON) and inspect just the detected difference (as JSON).

![Dataset Editing: Data Tab](images/dataset_data.jpeg)


### Sharing & Permissions Tab
- `Make dataset publicly accessible`: By default, a dataset can only be accessed by users from your organization with the correct access permissions. Turning a dataset to *public* will allow anyone in the general public to view the dataset when sharing a link to the dataset without the need for a webKnossos account. Anyone can start using this dataset to create annotations. Enable this setting if you want to share a dataset in a publication, social media, or any other public website.
- `Teams allowed to access this dataset`: Defines which [teams of your organization](./users.md) have permission to work with this dataset. By default, no team has access, but users with *admin* and *team manager* roles can see and edit the dataset.
- `Sharing Link`: A web URL pointing to this dataset for easy sharing that allows any user to view your dataset. The URL contains an access token to allow people to view the dataset without a webKnossos account. The access token is random, and therefore the URL cannot be guessed by visitors. You may also revoke the access token to create a new one. Anyone with a URL containing a revoked token will no longer have access to this dataset. 
Read more in [the Sharing guide](./sharing.md).

![Dataset Editing: Sharing Tab](images/sharing_tab.jpeg)

### Metadata Tab
- `Display Name`: A meaningful name for a dataset other than its (automatically assigned) technical name which is usually limited by the naming rules of file systems. It is displayed in various parts of webKnossos. The display name may contain special characters and can also be changed without invalidating already created sharing URLs. It can also be useful when sharing datasets with outsiders while "hiding" any internal naming schemes or making it more approachable, e.g., `L. Simpson et al.: Full Neuron Segmentation` instead of `neuron_seg_v4_2022`.
- `Description`: A free-text field for providing more information about your datasets, e.g., authors, paper reference, descriptions, etc. Supports Markdown formatting. The description will be featured in the webKnossos UI when opening a dataset in view mode.

![Dataset Editing: Metadata Tab](images/metadata_tab.jpeg)

### View Configuration Tab
The *View configuration* tab lets you set defaults for viewing this dataset. Anytime a user opens a dataset or creates a new annotation based on this dataset, these default values will be applied. 

Defaults include:

- `Position`: Default position of the dataset in voxel coordinates. When opening the dataset, users will be located at this position.
- `Zoom`: Default zoom.
- `Interpolation`: Whether interpolation should be enabled by default.
- `Layer Configuration`: Advanced feature to control the default settings on a per-layer basis. It needs to be configured in JSON format. E.g., layer visibility & opacity, color, contrast/brightness/intensity range ("histogram sliders"), and many more.

![Dataset Editing: View Configuration Tab](images/dataset_view_config.jpeg)

Of course, the defaults can all be overwritten and adjusted once a user opens the dataset in the main webKnossos interface and makes changes to any of these settings in his viewports. 

For self-hosted webKnossos instances, there are two ways to set default *View Configuration* settings:

- in the web UI as described above
- inside the `datasource_properties.json` on disk

The *View Configuration* from the web UI takes precedence over the `datasource_properties.json`.
You don't have to set complete *View Configurations* in either option, as webKnossos will fill missing attributes with sensible defaults.


### Delete Tab

Offers an option to delete a dataset and completely remove it from webKnossos. Be careful, this cannot be undone!

![Dataset Editing: Delete Tab](images/delete_tab.jpeg)


## Dataset Sharing
Read more in the [Sharing guide](./sharing.md#dataset-sharing)

## Using External Datastores
The system architecture of webKnossos allows for versatile deployment options where you can install a dedicated datastore server directly on your lab's cluster infrastructure.
This may be useful when dealing with large datasets that should remain in your data center.
[Please contact us](mailto:hello@webknossos.org) or [write a post](https://forum.image.sc/tag/webknossos), if you require any assistance with your setup.

scalable minds also offer a dataset alignment tool called *Voxelytics Align*.
[Learn more.](https://scalableminds.com/voxelytics-align)

![Dataset Alignment](https://www.youtube.com/watch?v=yYauIHZcI_4)

## Sample Datasets

For convenience and testing, we provide a list of sample datasets for webKnossos:

- **Sample_e2006_wkw**  
  Raw SBEM data and segmentation (sample cutout, 120MB).  
  [https://static.webknossos.org/data/e2006_wkw.zip](https://static.webknossos.org/data/e2006_wkw.zip)  
  Connectomic reconstruction of the inner plexiform layer in the mouse retina.  
  M Helmstaedter, KL Briggman, S Turaga, V Jain, HS Seung, W Denk.  
  Nature. 08 August 2013. [https://doi.org/10.1038/nature12346](https://doi.org/10.1038/nature12346)

- **Sample_FD0144_wkw**  
  Raw SBEM data and segmentation (sample cutout, 316 MB).  
  [https://static.webknossos.org/data/FD0144_wkw.zip](https://static.webknossos.org/data/FD0144_wkw.zip)  
  FluoEM, virtual labeling of axons in three-dimensional electron microscopy data for long-range connectomics.  
  F Drawitsch, A Karimi, KM Boergens, M Helmstaedter.  
  eLife. 14 August 2018. [https://doi.org/10.7554/eLife.38976](https://doi.org/10.7554/eLife.38976)

* **Sample_MPRAGE_250um**  
  MRI data (250 MB).  
  [https://static.webknossos.org/data/MPRAGE_250um.zip](https://static.webknossos.org/data/MPRAGE_250um.zip)  
  T1-weighted in vivo human whole brain MRI dataset with an ultra-fine isotropic resolution of 250 μm.
  F Lüsebrink, A Sciarra, H Mattern, R Yakupov, O Speck.  
  Scientific Data. 14 March 2017. https://doi.org/10.1038/sdata.2017.32
