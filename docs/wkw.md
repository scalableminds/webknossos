# WKW

[webknossos-wrap (WKW)](https://github.com/scalableminds/webknossos-wrap) is a format optimized for large datasets of 3D voxel imagery and supports compression, efficient cutouts, multi-channel, and several base datatypes.
It works well for large datasets and is built with modern file systems in mind and drives the majority of WEBKNOSSOS datasets.

WKW is versatile in the image formats it can hold: Grayscale, Multi-Channel, Segmentation, RGB, as well as a range of data types (e.g., `uint8`,  `uint16`, `float32`).
Additionally, WKW supports compression for disk space efficiency.

Each layer of a WKW dataset may contain one of the following:

* Grayscale data (8 Bit, 16 Bit, Float), also referred to as `color` data
* RGB data (24 Bit)
* Segmentation data (8 Bit, 16 Bit, 32 Bit)

## Example


## WKW Folder Structure
WEBKNOSSOS expects the following file structure for WKW datasets:

```
my_dataset             # One root folder per dataset
├─ color               # One sub-folder per layer (e.g., color, segmentation)
│  ├─ 1                # Magnification step (1, 2, 4, 8, 16 etc.)
│  │  ├─ header.wkw    # Header wkw file
│  │  ├─ z0
│  │  │  ├─ y0
│  │  │  │  ├─ x0.wkw  # Actual data wkw file
│  │  │  │  └─ x1.wkw  # Actual data wkw file
│  │  │  └─ y1/...
│  │  └─ z1/...
│  └─ 2/...
├─ segmentation/...
└─ datasource-properties.json  # Dataset metadata (will be created upon import, if non-existent)
```

# KNOSSOS Datasets
You can convert KNOSSOS-cube datasets with the [WEBKNOSSOS CLI tool](https://webknossos.org) to WKW and import that.

```
webknossos convert-knossos --layer-name color --voxel-size 11.24,11.24,25 data/source/mag1 data/target

```

#### Download "Volume Annotation" File Format

Volume annotations can be downloaded and imported using ZIP files that contain [WKW](./data_formats.md#wkw-datasets) datasets.
The ZIP archive contains one NML file that holds meta information including the dataset name and the user's position.
Additionally, there is another embedded ZIP file that contains the volume annotations in WKW file format.

!!!info
    In contrast to on-disk WKW datasets, the WKW files in downloaded volume annotations only contain a single 32^3 bucket in each file.
    Therefore, also the addressing of the WKW files (e.g. `z48/y5444/x5748.wkw`) is in steps of 32 instead of 1024.

```
volumetracing.zip # A ZIP file containing the volume annotation
├─ data.zip # Container for WKW dataset
│ └─ 1 # Magnification step folder
│   ├─ z48
│   │ ├─ y5444
│   │ │ └─ x5748.wkw # Actual WKW bucket file (32^3 voxel)
│   │ └─ y5445/...
│   ├─ z49/...
│   └─ header.wkw # Information about the WKW files
└─ volumetracing.nml # Annotation metadata NML file
```

After unzipping the archives, the WKW files can be read or modified with the WKW libraries that are available for [Python and MATLAB](./tooling.md).