# WKW

[webknossos-wrap (WKW)](https://github.com/scalableminds/webknossos-wrap) is a format optimized for large datasets of 3D voxel imagery and supports compression, efficient cutouts, multi-channel, and several base datatypes.
It works well for large datasets and is built with modern file systems in mind and drives a lot of WEBKNOSSOS datasets.

WKW is versatile in the image formats it can hold: Grayscale, Multi-Channel, Segmentation, RGB, as well as a range of data types (e.g., `uint8`,  `uint16`, `float32`).
Additionally, WKW supports compression for disk space efficiency.

The following table shows an overview of supported `dtypes` per layer:

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

## Examples

You can try the WKW support with the following datasets. Upload them to WEBKNOSSOS using the [web uploader](./upload_ui.md): 

- Mouse Retina SBEM and segmentation (sample cutout, 120MB)
    - [https://static.webknossos.org/data/e2006_wkw.zip](https://static.webknossos.org/data/e2006_wkw.zip)  
    - Source: Connectomic reconstruction of the inner plexiform layer in the mouse retina.  M Helmstaedter, KL Briggman, S Turaga, V Jain, HS Seung, W Denk.  Nature. 08 August 2013. [https://doi.org/10.1038/nature12346](https://doi.org/10.1038/nature12346)

- Mourse Cortex SBEM and segmentation (sample cutout, 316 MB)
    - [https://static.webknossos.org/data/FD0144_wkw.zip](https://static.webknossos.org/data/FD0144_wkw.zip)  
    - Source: FluoEM, virtual labeling of axons in three-dimensional electron microscopy data for long-range connectomics.  F Drawitsch, A Karimi, KM Boergens, M Helmstaedter.  eLife. 14 August 2018. [https://doi.org/10.7554/eLife.38976](https://doi.org/10.7554/eLife.38976)

- Whole Brain MRI (250 MB)
    - [https://static.webknossos.org/data/MPRAGE_250um.zip](https://static.webknossos.org/data/MPRAGE_250um.zip)  
    - Source: T1-weighted in vivo human whole brain MRI dataset with an ultra-fine isotropic resolution of 250 μm.  F Lüsebrink, A Sciarra, H Mattern, R Yakupov, O Speck.  Scientific Data. 14 March 2017. [https://doi.org/10.1038/sdata.2017.32](https://doi.org/10.1038/sdata.2017.32)


## WKW Folder Structure
WEBKNOSSOS expects the following file structure for WKW datasets:

```
my_dataset             # One root folder per dataset
├─ datasource-properties.json  # Dataset metadata (will be created upon import, if non-existent)
├─ color               # One sub-folder per layer (e.g., color, segmentation)
│  ├─ 1                # Magnification step (1, 2, 4, 8, 16 etc.)
│  │  ├─ header.wkw    # Header wkw file
│  │  ├─ z0
│  │  │  ├─ y0
│  │  │  │  ├─ x0.wkw  # Actual data wkw file (chunks)
│  │  │  │  └─ x1.wkw  # Actual data wkw file
│  │  │  └─ y1/...
│  │  └─ z1/...
│  └─ 2/...
└─ segmentation/...

```

## KNOSSOS Datasets
You can convert KNOSSOS-cube datasets with the [WEBKNOSSOS CLI tool](https://webknossos.org) to WKW and import that.

```
webknossos convert-knossos --layer-name color --voxel-size 11.24,11.24,25 data/source/mag1 data/target
```

## Download "Volume Annotation" File Format

Volume annotations can be downloaded and imported using ZIP files that contain [WKW](../data/wkw.md) datasets.
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

After unzipping the archives, the WKW files can be read or modified with the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/examples/load_annotation_from_file.html).