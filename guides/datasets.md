# Managing Datasets

3D image datasets are at the heart of webKnossos. [Import datasets](datasets.md#importing-datasets) via the file system or the upload feature. [Configure the dataset](datasets.md#edit-dataset) defaults and permissions to your specification. [Share your datasets](sharing.md#dataset-sharing) with the public or with selected users.

## Importing Datasets

### Convert Datasets

If your dataset is not yet in WKW or KNOSSOS format, you need to convert it. The [webKnossos Cuber](https://github.com/scalableminds/webknossos-cuber) is a tool that can convert many formats to WKW in order to be used with webKnossos. Read more in the [Data Formats documentation](../reference/data_formats.md).

### Uploading through the File System

To efficienty import large datasets, we recommend to place them directly in the file system:

* Place the dataset at `<webKnossos directory>/binaryData/<Organization name>/<Dataset name>`. For example `/srv/webknossos/binaryData/Springfield_University/great_dataset`.
* Go to the [dataset view on the dashboard](dashboard.md)
* Use the refresh button on the dashboard or wait for webKnossos to detect the dataset \(up to 10min\)
* Click `Import` for your new dataset
* Complete the [Import screen](datasets.md#importing-in-webknossos)

### Uploading through the web browser

To quickly import a dataset, you may use the upload functionality from webKnossos. This is only recommended for datasets up to 1 GB.

In order to upload the datasets, create a ZIP file that contains the WKW or KNOSSOS cubes in the folder structure as described in the [Data Formats guide](../reference/data_formats.md). Once the data is uploaded you need to complete the [Import screen](datasets.md#importing-in-webknossos).

### Importing in webKnossos

The Import screen allows you to set some properties of your datasets. Many properties such as available layers, bounding boxes and datatypes can be detected automatically. Some properties require your manual input, though. Most of the time these are **scale** which represents the physical size of one voxel in nanometers and **largestSegmentId** of a segmentation layer.

Once you entered the required properties, you can click the `Import` button to complete the process. The dataset is now ready to use.

{% hint style="info" %}
If you uploaded the dataset along with a `datasource-properties.json` metadata file the dataset will be imported automatically without any additional manual steps.
{% endhint %}

## Edit Dataset

You can edit the properties of a dataset at any time. In addition to the required properties that you need to fill in during import, there are more advanced properties that you can set. This screen is similar to the Import screen and split into three tabs:

### Data

* `Scale`: The physical size of a voxel in nanometers, e.g. `11, 11, 24`
* `Bounding Box`: The position and extents of the dataset layer in voxel coordinates. The format is `x,y,z,x_size,y_size,z_size` or respectively `min_x,min_y,min_z,(max_x-min_x),(max_y-min_y),(max_z-min_z)`.
* `Largest Segment ID`: The highest ID that is currently used in the respective segmentation layer. This is required for volume annotations where new objects with incrementing IDs are created. Only applies to segmentation layers.

The `Advanced` view lets you edit the underlying JSON configuration directly.

![Dataset Editing: Data Tab](../.gitbook/assets/dataset_data%20%283%29.png)

### General

* `Display Name`: Used as the name of the dataset in the [Gallery view](sharing.md#public-sharing).
* `Description`: Contains more information about your datasets including authors, paper reference, descriptions. Supports Markdown formatting. The description will be featured in the [Gallery view](sharing.md#public-sharing) as well.
* `Allowed Teams`: Defines which [teams of your organization](users.md) have access to this dataset. By default no team has access but admins and team managers can see and edit the dataset.
* `Visibility`: Lets you make the dataset available to the general public and shows it in the public [Gallery view](sharing.md#public-sharing). This will enable any visitor to your webKnossos instance to view the data, even unregistered users.
* `Sharing Link`: A special URL which allows any user to view your dataset that uses this link. Because of the included random token, the link cannot be guessed by random visitors. You may also revoke the random token and create a new one when you don't want previous users to access your data anymore. Read more in [the Sharing guide](sharing.md).

![Dataset Editing: General Tab](../.gitbook/assets/dataset_general%20%283%29.png)

### View Configuration

* `Position`: Default position of the dataset in voxel coordinates. When opening the dataset, users will be located at this position.
* `Zoom`: Default zoom.
* `Segmentation Opacity`: Default opacity of the segmentation layer.
* `Interpolation`: Whether interpolation should be enabled by default.
* `Layer Configuration`: This is an advanced feature to control the default settings \(e.g. brightness, contrast, color\) per layer. It needs to be configured in a JSON format.

![Dataset Editing: View Configuration Tab](../.gitbook/assets/dataset_view_config%20%281%29.png)

## Dataset Sharing

Read more in the [Sharing guide](sharing.md#dataset-sharing)

## Using External Datastores

The system architecture of webKnossos allows for versatile deployment options where you can install a dedicated datastore server directly on your lab's cluster infrastructure. This may be useful when dealing with large datasets that should remain in your data center. [Please contact us](mailto:hello@scalableminds.com) if you require any assistance with your setup.

