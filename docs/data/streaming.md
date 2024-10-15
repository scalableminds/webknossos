# Streaming from remote servers and the cloud

WEBKNOSSOS supports loading and remotely streaming [Zarr](https://zarr.dev), [Neuroglancer precomputed format](https://github.com/google/neuroglancer/tree/master/src/neuroglancer/datasource/precomputed) and [N5](https://github.com/saalfeldlab/n5) datasets from a remote source, e.g. Cloud storage (S3 / GCS) or HTTP server. 
WEBKNOSSOS supports loading Zarr datasets according to the [OME NGFF v0.4 spec](https://ngff.openmicroscopy.org/latest/).

WEBKNOSSOS can load several remote sources and assemble them into a WEBKNOSSOS dataset with several layers, e.g. one Zarr file/source for the `color` layer and one Zarr file/source for a `segmentation` layer. 
If you create the remote Zarr dataset with the [WEBKNOSSOS Python library](https://docs.webknossos.org/api/webknossos/dataset/dataset.html), all layers will be automatically detected. 
With other converters, you may need to add the layers separately.

1. From the *Datasets* tab in the user dashboard, click the *Add Dataset* button.
2. Select the *Add Remote Dataset* tab
3. For each layer, provide some metadata information:  
    - a URL or domain/collection identifier to locate the dataset on the remote service (supported protocols are HTTPS, Amazon S3 and Google Cloud Storage).
    - authentication credentials for accessing the resources on the remote service (optional)
4. Click the *Add Layer* button
5. WEBKNOSSOS will automatically try to infer as many dataset properties (voxel size, bounding box, etc.) as possible and preview a [WEBKNOSSOS `datasource` configuration](../data/concepts.md#dataset-metadata-specification) for your to review. 
  Consider setting the dataset `name` property and double-check all other properties for correctness.
6. Click `Import` to finish

WEBKNOSSOS can also import URIs from [Neuroglancer](https://github.com/google/neuroglancer). When viewing a dataset on a Neuroglancer instance in the browser,
copy the URI from the address bar and paste it into the *Add Remote Dataset* tab to view the dataset in WEBKNOSSOS.

WEBKNOSSOS will NOT download or copy datasets in full from these third-party data providers. 
Rather, any data viewed in WEBKNOSSOS will be streamed read-only from the remote source. 
These remote datasets will not count against your storage quota on WEBKNOSSOS. 
Any other WEBKNOSSOS feature, e.g., annotations, and access rights, will be stored in WEBKNOSSOS and do not affect these services. 

Note that data streaming may incur costs and count against any usage limits or minutes as defined by these third-party services. Check with the service provider or dataset owner.

![youtube-video](https://www.youtube.com/embed/43dvqqAg_MQ)
