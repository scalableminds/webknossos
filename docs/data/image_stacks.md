# Image Stacks

WEBKNOSSOS works with a wide range of modern bio-imaging formats and image stacks:

- [Image file sequence](#single-layer-image-file-sequence) in one folder (TIFF, JPEG, PNG, DM3, DM4 etc)
- [Multi layer file sequence](#multi-layer-image-file-sequence) containing multiple folders with image sequences that are interpreted as separate layers
- [Single-file images](#single-file-images) (OME-TIFF, TIFF, PNG, czi, raw, etc)

Image stacks need to be converted to [Zarr](./zarr.md) or [WKW](./wkw.md) datasets for WEBKNOSSOS. This happens automatically when using the web upload on [webknossos.org](https://webknossos.org) or can be done manually (see below).

## Single-Layer Image File Sequence
When uploading multiple image files, these files are sorted numerically, and each one is interpreted as single section/slice within a 3D dataset.
Alternatively, the same files can also be uploaded bundled in a single folder (or zip archive).

As an example, the following file structure would create a dataset with one layer which has a z-depth of 3:

```
dataset_name/
├── image_1.tif
├── image_2.tif
├── image_3.tif
└── ...
```

## Multi-Layer Image File Sequence
The image file sequences explained above can be composed to build multiple [layers](./concepts.md#layers) within a single dataset.
For example, the following file structure (note the additional hierarchy level) would create a dataset with two layers (named `color` and `segmentation`):

```
dataset_name/
├── color
│ ├── image_1.tif
│ ├── image_2.tif
│ └── ...
└── segmentation
  └── ...
```

## Single-file images
WEBKNOSSOS understands most modern bio-imaging file formats and uses the [BioFormats library](https://www.openmicroscopy.org/bio-formats/) upon import/conversion. It works particularly well with:

- OME-Tiff
- Tiff
- PNG
- JPEG
- czi
- nifti
- raw
- DM3
- DM4


## Manual Conversion

You can manually convert image stacks through:

- [WEBKNOSSOS CLI](https://docs.webknossos.org/cli)
- [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py)

### Conversion with CLI
You can easily convert image stacks manually with the WEBKNOSSOS CLI.
The CLI tool expects all image files in a single folder with numbered file names.
After installing, you can convert image stacks to Zarr3 datasets with the following command:

```shell
pip install webknossos

webknossos convert \
  --voxel-size 11.24,11.24,25 \
  --name my_dataset \
  data/source data/target
```

This snippet converts an image stack that is located in directory called `data/source` into a Zarr3 dataset which will be located at `data/target`.
It will create a so called `color` layer containing your raw greyscale/color image.
The supplied `--voxel-size` is specified in nanometers.

Read the full documentation at [WEBKNOSSOS CLI](https://docs.webknossos.org/cli).

### Conversion with Python

You can use the free [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py) to convert image stacks to Zarr v3 or integrate the conversion as part of an existing workflow. 

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
    )

    print(f"Saved {dataset.name} at {dataset.path}.")

    with wk.webknossos_context(token="..."):
        dataset.upload()


if __name__ == "__main__":
    main()
```

Read the full example in the WEBKNOSSOS [Python library documentation](https://docs.webknossos.org/webknossos-py/examples/create_dataset_from_images.html).

---

[Please contact us](mailto:hello@webknossos.org) or [write a post in our support forum](https://forum.image.sc/tag/webknossos), if you have any issues with converting your datasets.