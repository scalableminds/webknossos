# Zarr & NGFF

WEBKNOSSOS works great with [OME Zarr datasets](https://ngff.openmicroscopy.org/latest/index.html), sometimes called next-generation file format (NGFF).

The Zarr format is a good alternative to [WKW](./wkw.md) and will likely replace it long term.

Zarr datasets can both be uploaded to WEBKNOSSOS through the [web uploader](./datasets.md#uploading-through-the-web-browser) or [streamed from a remote server or the cloud](./datasets.md#streaming-from-remote-servers-and-the-cloud).

## Example

## Zarr Folder Struture
WEBKNOSSOS expects the following file structure for Zarr datasets:

```
.                             # Root folder, potentially in S3,
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

You can easily convert image stacks manually with the WEBKNOSSOS CLI.
The CLI tool expects all image files in a single folder with numbered file names.
After installing, you can convert image stacks to Zarr datasets with the following command:

```
pip install webknossos

webknossos convert-zarr \
  --voxel-size 11.24,11.24,25 \
  --name my_dataset \
  data/source data/target
```

This snippet converts an image stack that is located in directory called `data/source` into a Zarr dataset which will be located at `data/target`.
It will create a so called `color` layer containing your raw greyscale/color image.
The supplied `--voxel-size` is specified nanometers.

Read the full documentation at [WEBKNOSSOS CLI](https://docs.webknossos.org/cli).