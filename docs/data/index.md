# Data Sources and Upload / Download

WEBKNOSSOS uses several file formats for reading large-scale volumetric image data and storing skeleton and volume annotations. The section will provide technical backgrounds on these file formats, list examples, and explain concepts and details.

WEBKNOSSOS natively supports loading and streaming data in the following formats:

- [WEBKNOSSOS-wrap (WKW)](./wkw.md)
- [OME-Zarr / NGFF](./zarr.md)
- [Neuroglancer precomputed](./neuroglancer_precomputed.md)
- [N5](./n5.md)
- [Image Stacks (through Conversion)](./image_stacks.md)

The WEBKNOSSOS-wrap (WKW) container format is used for all internal voxel data representations - both for the raw (microscopy) image datasets and segmentations. Skeleton annotations are saved as NML files. 

Any dataset uploaded to webknossos.org will automatically be converted to WKW on upload - given its source file format is supported by WEBKNOSSOS. Alternatively, you can manually convert your datasets using the [WEBKNOSSOS CLI tool](https://docs.webknossos.org/cli) or use a custom script based on the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/index.html).

Read more about uploading and configuring datasets on the [datasets page](../datasets/settings.md).
