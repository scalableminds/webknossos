### Uploading through the web UI
The easiest way to get started with working on your datasets is through the WEBKNOSSOS web interface. You can directly upload your dataset through the browser.

1. From the *Datasets* tab in the user dashboard, click the *Add Dataset* button.
2. Provide some metadata information:  
    - a *name* 
    - give access permissions for one or more teams (use the `default` team if all members of your organization should be able to see it)
    - *scale* of each voxel (in nanometers)
3. Drag and drop your data into the upload section
4. Click the *Upload* button

![youtube-video](https://www.youtube.com/embed/ZvUJrv86w8w?start=17)

Internally, WEBKNOSSOS uses the [Zarr3](./zarr.md) format by default to display your data.
If your data is already in a data format like [WKW](./wkw.md), [Zarr or Zarr3](./zarr.md) you can simply drag your folder (or zip archive of that folder) into the upload view.

If your data is not in WKW or Zarr format, you can either:

- upload the data in a supported file format and WEBKNOSSOS will automatically import or convert it ([webknossos.org](https://webknossos.org) only). 
Depending on the size of the dataset, the conversion will take some time. 
You can check the progress at the [`Jobs`](../automation/jobs.md) page or the "Datasets" tab in the dashboard.
WEBKNOSSOS will also send you an email notification.
- Convert your data manually to WKW. For this, we provide the following software tools and libraries:
    - The [WEBKNOSSOS CLI](https://docs.webknossos.org/cli) is a CLI tool that can convert many formats to WKW. 
    - For other file formats, the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/index.html) can be an option for custom scripting.

In particular, the following file formats are supported for uploading (and conversion):

- [WKW dataset](./wkw.md)
- [OME-Zarr datasets](./zarr.md)
- [Image file sequence](./image_stacks.md#single-layer-image-file-sequence) in one folder (TIFF, JPEG, PNG, DM3, DM4)
- [Multi Layer file sequence](./image_stacks.md#multi-layer-image-file-sequence) containing multiple folders with image sequences that are interpreted as separate layers
- [Single-file images](./image_stacks.md#single-file-images) (OME-Tiff, TIFF, PNG, czi, raw, etc)
- [Neuroglancer Precomputed datasets](./neuroglancer_precomputed.md)
- [N5 datasets](./n5.md)

We support a variety of data types for the uploaded data. To make sure that your data can be uploaded to WEBKNOSSOS take a look into this table of supported data types for color and segmentation layers:

|   dtype    | Color Layers  |       Segmentation Layers   |
|------------|------------|------------|
|   uint8    |       ✓     |   ✓                       |
|   uint16   |       ✓     |   ✓                       |
|   uint24  rgb  |       ✓   |   does not apply        |
|   uint32   |       ✓     |   ✓                       |
|   uint64   |       ✗     |   (✓)  [(til 2⁵³−1)](https://github.com/scalableminds/webknossos/issues/6921)          |
|   |  |  |  |
|    int8    |       ✓     |        ✓                   |
|    int16   |       ✓     |        ✓                   |
|    int32   |       ✓     |        ✓                   |
|    int64   |       ✗     |        ✓                   |
|   |  |  |  |
|    float   |       ✓     |        ✗                   |
|    double  |       ✗     |        ✗                   |

Once the data is uploaded (and potentially converted), you can further configure a dataset's [Settings](../datasets/settings.md) and double-check layer properties, fine tune access rights & permissions, or set default values for rendering.