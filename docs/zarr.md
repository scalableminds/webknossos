# OME-Zarr & NGFF

WEBKNOSSOS works great with [OME-Zarr datasets](https://ngff.openmicroscopy.org/latest/index.html), sometimes called next-generation file format (NGFF).

We strongly believe in this community-driven, cloud-native data format for n-dimensional datasets. Zarr is a first-class citizen in WEBKNOSSOS and will likely replace [WKW](./wkw.md) long term.

Zarr datasets can both be uploaded to WEBKNOSSOS through the [web uploader](./datasets.md#uploading-through-the-web-browser) or [streamed from a remote server or the cloud](./datasets.md#streaming-from-remote-servers-and-the-cloud). When streaming and using several layers, import the first Zarr group and then use the UI to add more URIs/groups.

## Examples

You can try the OME-Zarr support with the following datasets. Load them in WEBKNOSSOS as a [remote dataset](./datasets.md#streaming-from-remote-servers-and-the-cloud): 


- Mouse Cortex Layer 4 EM Cutout over HTTPs
    - `https://static.webknossos.org/data/l4_sample/`
    - Source: Dense connectomic reconstruction in layer 4 of the somatosensory cortex. Motta et al. Science 2019. [10.1126/science.aay3134](https://doi.org/10.1126/science.aay3134)

## Zarr Folder Structure
WEBKNOSSOS expects the following file structure for OME-Zarr (v0.4) datasets:

```
.                             # Root folder,
│                             # with a flat list of images by image ID.
│
└── 456.zarr                  # Another image (id=456) converted to Zarr.
    │
    ├── .zgroup               # Each image is a Zarr group, or a folder, of other groups and arrays.
    ├── .zattrs               # Group level attributes are stored in the .zattrs file and include
    │                         # "multiscales" and "omero" (see below). In addition, the group level attributes
    │                         # may also contain "_ARRAY_DIMENSIONS" for compatibility with xarray if this group directly contains multi-scale arrays.
    │
    ├── 0                     # Each multiscale level is stored as a separate Zarr array,
    │   ...                   # which is a folder containing chunk files which compose the array.
    ├── n                     # The name of the array is arbitrary with the ordering defined by
    │   │                     # by the "multiscales" metadata, but is often a sequence starting at 0.
    │   │
    │   ├── .zarray           # All image arrays must be up to 5-dimensional
    │   │                     # with the axis of type time before type channel, before spatial axes.
    │   │
    │   └─ t                  # Chunks are stored with the nested directory layout.
    │      └─ c               # All but the last chunk element are stored as directories.
    │         └─ z            # The terminal chunk is a file. Together the directory and file names
    │            └─ y         # provide the "chunk coordinate" (t, c, z, y, x), where the maximum coordinate
    │               └─ x      # will be dimension_size / chunk_size.
    │
    └── labels
        │
        ├── .zgroup           # The labels group is a container which holds a list of labels to make the objects easily discoverable
        │
        ├── .zattrs           # All labels will be listed in .zattrs e.g. { "labels": [ "original/0" ] }
        │                     # Each dimension of the label (t, c, z, y, x) should be either the same as the
        │                     # corresponding dimension of the image, or 1 if that dimension of the label
        │                     # is irrelevant.
        │
        └── original          # Intermediate folders are permitted but not necessary and currently contain no extra metadata.
            │
            └── 0             # Multiscale, labeled image. The name is unimportant but is registered in the "labels" group above.
                ├── .zgroup   # Zarr Group which is both a multiscaled image as well as a labeled image.
                ├── .zattrs   # Metadata of the related image and as well as display information under the "image-label" key.
                │
                ├── 0         # Each multiscale level is stored as a separate Zarr array, as above, but only integer values
                │   ...       # are supported.
                └── n
```

See [OME-Zarr 0.4 spec](https://ngff.openmicroscopy.org/latest/index.html#image-layout) for details.

## Conversion to Zarr

You can easily convert image stacks manually with the [WEBKNOSSOS CLI](https://docs.webknossos.org/cli).
The CLI tool expects all image files in a single folder with numbered file names.
After installing, you can convert image stacks to Zarr datasets with the following command:

```shell
pip install webknossos

webknossos convert \
  --voxel-size 11.24,11.24,25 \
  --name my_dataset \
  --data-format zarr \
  data/source data/target
```

This snippet converts an image stack that is located in directory called `data/source` into a Zarr dataset which will be located at `data/target`.
It will create a so called `color` layer containing your raw greyscale/color image.
The supplied `--voxel-size` is specified in nanometers.

Read the full documentation at [WEBKNOSSOS CLI](https://docs.webknossos.org/cli).

### Conversion with Python

You can use the free [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py) to convert image stacks to Zarr or integrate the conversion as part of an existing workflow. 

```python
import webknossos as wk

def main() -> None:
    """Convert a folder of image files to a WEBKNOSSOS dataset."""
    dataset = wk.Dataset.from_images(
        input_path=INPUT_DIR,
        output_path=OUTPUT_DIR,
        voxel_size=(11, 11, 11),
        layer_category=wk.COLOR_CATEGORY,
        compress=True,
        data_format=wk.Dataformat.Zarr
    )

    print(f"Saved {dataset.name} at {dataset.path}.")

    with wk.webknossos_context(token="..."):
        dataset.upload()


if __name__ == "__main__":
    main()
```

Read the full example in the WEBKNOSSOS [Python library documentation](https://docs.webknossos.org/webknossos-py/examples/create_dataset_from_images.html).

## Time-Series and N-Dimensional Datasets

WEBKNOSSOS also supports loading n-dimensional datasets, e.g. 4D = time series of 3D microscopy.
This feature in currently only supported for Zarr dataset due to their flexbile structure and design for n-dimensional data.

## Performance Considerations
To get the best streaming performance for Zarr datasets consider the following settings.

- Use chunk sizes of 32 - 128 voxels^3
- Enable sharding (only available in Zarr 3+)
