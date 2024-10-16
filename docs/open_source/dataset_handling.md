# Handling Datasets

## Uploading through the File System

On self-hosted instances, large datasets can be efficiently imported by placing them directly on the file system (WKW-format or Zarr only):

* Place the dataset at `<WEBKNOSSOS directory>/binaryData/<Organization name>/<Dataset name>`. For example `/opt/webknossos/binaryData/Springfield_University/great_dataset`.
* Go to the [dataset view on the dashboard](../dashboard/datasets.md)
* Use the `Scan disk for new dataset` from the dropdown menu next to the `Refresh` button on the dashboard or wait for WEBKNOSSOS to detect the dataset (up to 10min)

Typically, WEBKNOSSOS can infer all the required metadata for a dataset automatically and import datasets automatically on refresh. In some cases, you will need to manually import a dataset and provide more information:

* On the dashboard, click *Import* for your new dataset
* Provide the requested properties, such as *scale*. It is also recommended to set the *largestSegmentId*. See the article on [configuring dataset settings](../datasets/settings.md) for more detailed explanations of these parameters.

!!! info
    If you uploaded the dataset along with a `datasource-properties.json` metadata file, the dataset will be imported automatically without any additional manual steps.


## Using Symbolic Links

When you have direct file system access, you can also use symbolic links to import your data into WEBKNOSSOS. This might be useful when you want to create new datasets based on potentially very large raw microscopy data and symlink it to one or several segmentation layers.

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
