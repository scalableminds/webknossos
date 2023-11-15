# Image Stacks

WEBKNOSSOS works with a wide range of modern bio-imaging formats and image stacks:

- [Image file sequence](#Single-Layer-Image-File-Sequence) in one folder (TIFF, JPEG, PNG, DM3, DM4)
- [Multi Layer file sequence](#Multi-Layer-Image-File-Sequence) containing multiple folders with image sequences that are interpreted as separate layers
- [Single-file images](#single-file-images) (OME-Tiff, TIFF, PNG, czi, raw, etc)

Image stacks need to be converted to [WKW](./wkw.md) for WEBKNOSSOS. This happens automatically when using the web upload on https://webknossos.org or can be done manually (see below).

## Single-Layer Image File Sequence
When uploading multiple image files, these files are sorted numerically, and each one is interpreted as one section within a 3D dataset.
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
The image file sequences explained above can be composed to build multiple [layers](#Layers).
For example, the following file structure (note the additional hierarchy level) would create a dataset with two layers (named `color` and `segmentation`):

```
dataset_name/
├── color
│ ├── image_1.tif
│ ├── image_2.tif
│ └── ...
├── segmentation
│ └── ...
```

## Single-file images
WEBKNOSSOS understands most modern bio-imaging file formats and uses the [BioFormats library] upon import/conversion. It works particularly well with:

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

### CLI
You can easily convert image stacks manually with the WEBKNOSSOS CLI.
The CLI tool expects all image files in a single folder with numbered file names.
After installing, you can convert image stacks to WKW datasets with the following command:

```
pip install webknossos

webknossos convert \
  --voxel-size 11.24,11.24,25 \
  --name my_dataset \
  data/source data/target
```

This snippet converts an image stack that is located in directory called `data/source` into a WKW dataset which will be located at `data/target`.
It will create a so called `color` layer containing your raw greyscale/color image.
The supplied `--voxel-size` is specified nanometers.

Read the full documentation at [WEBKNOSSOS CLI](https://docs.webknossos.org/cli).

### Python

You can use the free [WEBKNOSSSO Python library](https://docs.webknossos.org/webknossos-py) to convert image stacks to WKW or integrate the convesion as part of existing workflow. 

```
from webknossos import Dataset
from webknossos.dataset import COLOR_CATEGORY

def main() -> None:
    """Convert a folder of image files to a WEBKNOSSOS dataset."""
    dataset = Dataset.from_images(
        input_path=INPUT_DIR,
        output_path=OUTPUT_DIR,
        voxel_size=(11, 11, 11),
        layer_category=COLOR_CATEGORY,
        compress=True,
    )

    print(f"Saved {dataset.name} at {dataset.path}.")

    # dataset.upload()


if __name__ == "__main__":
    main()
```

Read the full example in the WEBKNOSSOS [Python library documentation].(https://docs.webknossos.org/webknossos-py/examples/create_dataset_from_images.html)

[Please contact us](mailto:hello@webknossos.org) or [write a post in our support forum](https://forum.image.sc/tag/webknossos), if you have any issues with converting your dataset.