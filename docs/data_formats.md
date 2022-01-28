# Supported Data Formats

webKnossos uses the webKnosso-wrap (WKW) container format for all (internal) data representations - both for the raw (microscopy) image datasets and segmentations. Skeleton annotations are saved as NML files. This section explain these formats in detail.

Any dataset uploaded to webKnossos.org, will automatically be converted to WKW on upload - given its file format can be read by webKnossos. Alternatively, you can manually convert your datasets using the [webKnossos Cuber CLI tools](https://docs.webknossos.org/wkcuber/index.html).

Additionally, webKnossos.org supports connecting and loading data from:
- Neuroglancer Pre-Computed Dataset stored on Google Cloud
- BossDB

The following sections explain the concepts and file formats which are supported by webKnossos. See page on [software tooling](.tooling.md) for working with these file formats in Python and MatLab.

### Conversion with webknossos.org
When uploading data to [webKnossos](https://webknossos.org), various data formats are automatically detected and converted.

In particular, the following file formats are supported:
                
- [WKW dataset](#WKW-Datasets)
- [Image file sequence](#Single-Layer-Image-File-Sequence) in one folder (tif, jpg, png, dm3, dm4)
  - as an extension, multiple folders with image sequences are interpreted as [separate layers](#Multi-Layer-Image-File-Sequence)
- Single-file images (tif, czi, nifti, raw)
- KNOSSOS file hierarchy 

#### Single-Layer Image File Sequence
When uploading multiple image files, these files are sorted numerically and each is interpreted as one section within a 3D dataset.
Alternatively, the same files can also be uploaded bundled in a single folder (or zip archive).

As an example, the following file structure would create a dataset with one layer which has a z-depth of 3.

```
dataset_name/
├── image_1.tif
├── image_2.tif
├── image_3.tif
└── ...
```

#### Multi-Layer Image File Sequence
The image file sequences explained above can be composed to build multiple [layers](#Layers).
As an example, the following file structure (note the additional hierarchy level) would create a dataset with two layers (named `color` and `segmentation`).

```
dataset_name/
├── color
│ ├── image_1.tif
│ ├── image_2.tif
│ └── ...
├── segmentation
│ └── ...
```

#### Single-file images
The following file formats can be dragged individually into webKnossos to convert them to a 3D dataset:

- tif
- czi
- nifti
- raw
- dm3
- dm4
- png

#### KNOSSOS file hierarchy
Datasets saved as KNOSSOS cubes also be converted on [webKnossos](https://webknossos.org).
Please ensure that you import the correct folder (so that all layers of the dataset are contained).


## Concepts

### Datasets, Cubes, and Buckets

A **dataset** consists of [one or more layers](#layers).
Since webKnossos deals with 3D imagery, the data is organized in **cubes**.
WKW cubes are 1024^3 voxels in size by default and each cube is stored as one file on disk.
Each cube contains multiple **buckets** of 32^3 voxel size.
This is the unit in which the data is streamed to the users' browser.

![Datasets, Cubes, and Buckets](images/cubes-and-buckets.png)

### Layers

A dataset consists of one or more layers.

For microscopy/CT/MRI data, there is usually a `color` layer that holds the raw grayscale image data.
Additionally, there may be one or more `segmentation` layers that hold manually or automatically generated volume annotations (one ID per voxel).

A webKnossos dataset can contain several `color` and `segmentation` layers which can be rendered invidiually or overlayed on top of each other. The maxmium number of visible layers depends on your GPU hardare - typically 16 layers.

![Color and Segmentation Layers](images/datalayers.png)

### Magnification Steps and Downsampling

To enable zooming within huge datasets in webKnossos, dataset layers usually contain multiple magnification steps (also called mipmaps or image pyramids).
`1` is the magnification step with the highest resolution, i.e. the original data.
`2` is downsampled by by a factor of two in all dimensions and therefore only is an eighth of the file size of the original data.
Downsampling is done in power-of-two steps: `1, 2, 4, 8, 16, 32, 64, …`

webKnossos also supports non-uniform downsampling. For example, `[2, 2, 1]` is downsampled in the `x` and `y` dimension, but not in `z`.

![Downsampling the data to improve zooming](images/downsampling.png)


### Segmentation

Segmentations in webKnossos are represented by ID maps.
Every segment or component has its own ID.
These IDs are stored as the value of the corresponding voxel, just as the grayscale value in the voxels of the color layer.
`0` is usually interpreted as missing or empty value.
The underlying datatype limits the maximum number of IDs:

| Data Type | Maximum ID                 |
| --------- | -------------------------- |
| `uint8`   | 255                        |
| `uint16`  | 65,535                     |
| `uint32`  | 4,294,967,295              |
| `uint64`  | 18,446,744,073,709,551,615 |

## Data Formats

To bring the above concepts together, webKnossos uses [webknossos-wrap (WKW)](https://github.com/scalableminds/webknossos-wrap) as a container format for volumetric voxel data.
For sparse skeleton-like structures, webKnossos uses [NML](#NML).

### WKW Datasets
[webknossos-wrap (WKW)](https://github.com/scalableminds/webknossos-wrap) is a format optimized for large datasets of 3D voxel imagery and supports compression, efficient cutouts, multi-channel and several base datatypes.
It works well for large datasets and is built with modern file systems in mind.
Compared to KNOSSOS datasets, it is more efficient because it orders the data within the container for optimal read performance (Morton order).
WKW is versatile in the image formats it can hold: Grayscale, Multi-Channel, Segmentation, RGB as well as a range of data types (e.g., `uint8`,  `uint16`, `float32`).
Additionally, WKW supports compression for disk space efficiency.

Each layer of a WKW dataset may contain one of the following:
* Grayscale data (8 Bit, 16 Bit, Float), also referred to as `color` data
* RGB data (24 Bit)
* Segmentation data (8 Bit, 16 Bit, 32 Bit)

#### WKW Folder Structure
A WKW dataset is represented with the following file system structure:

```
great_dataset          # One folder per dataset
├─ color               # Dataset layer (e.g., color, segmentation)
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

#### WKW Metadata by Example
Metadata is stored in the `datasource-properties.json`.
See below for the [full specification](#dataset-metadata-specification).
This is an example:

```json
{
  "id" : {
    "name" : "great_dataset",
    "team" : "<unknown>"
  },
  "dataLayers" : [ {
    "name" : "color",
    "category" : "color",
    "boundingBox" : {
      "topLeft" : [ 0, 0, 0 ],
      "width" : 1024,
      "height" : 1024,
      "depth" : 1024
    },
    "wkwResolutions" : [
        { "resolution": 1, "cubeLength": 1024 },
        { "resolution": [ 2, 2, 1 ], "cubeLength": 1024 },
        { "resolution": [ 4, 4, 1 ], "cubeLength": 1024 },
        { "resolution": [ 8, 8, 1 ], "cubeLength": 1024 },
        { "resolution": [ 16, 16, 2 ], "cubeLength": 1024 },
      ],
    "elementClass" : "uint8",
    "dataFormat" : "wkw"
  }, {
    "name" : "segmentation",
    "boundingBox" : {
      "topLeft" : [ 0, 0, 0 ],
      "width" : 1024,
      "height" : 1024,
      "depth" : 1024
    },
    "wkwResolutions" : [ {
      "resolution" : 1,
      "cubeLength" : 1024
    }, {
      "resolution" : [ 2, 2, 1 ],
      "cubeLength" : 1024
    } ],
    "elementClass" : "uint32",
    "largestSegmentId" : 1000000000,
    "category" : "segmentation",
    "dataFormat" : "wkw"
  } ],
  "scale" : [ 11.24, 11.24, 28 ]
}
```

Note that the `resolutions` property within the elements of `wkwResolutions` can be an array of length 3.
The three components within such a resolution denote the scaling factor for x, y, and z.
At the moment, WebKnossos guarantees correct rendering of data with non-uniform resolution factors only if the z-component between two resolutions changes by a factor of 1 or 2.

Most users do not create these metadata files manually.
webKnossos can infer most of these properties automatically, except for `scale` and `largestSegmentId`.
During the data import process, webKnossos will ask for the necessary properties.
When using the [webKnossos Cuber](https://github.com/scalableminds/webknossos-libs/tree/master/wkcuber), a metadata file is automatically generated. Alternatively, you can create and edit webKnossos datasets using the [webKnossos Python library](https://github.com/scalableminds/webknossos-libs/).

[See below for the full specification](#dataset-metadata-specification).

#### Dataset Metadata Specification

- `id`: This section contains information about the name and corresponding team of the dataset. However, this information is not used by webKnossos because it will be replaced by more accurate runtime information.
  + `id.name`: Name of the dataset. Just for reference purposes. Will be inferred/overwritten by the folder name.
  + `id.team`: Team to which this dataset belongs. Just for reference purposed. Will be inferred/overwritten by webKnossos.

- `dataLayers`: This array contains information about the layers of the dataset.
  + `dataLayers.name`: Name of the layer. Can be an arbitrary string, but needs to correspond to the folder in the file system. Needs to be unique within the dataset. Usually is either `color`, `segmentation` or `color_0`.
  + `dataLayers.category`: Either `color` for raw data or `segmentation` for segmentation layers.
  + `dataLayers.boundingBox`: The position and size of the data that is contained in this layer. `topLeft` holds the `min_x,min_y,min_z` position, `width` is `max_x - min_x`, `height` is `max_y - min_y` and `depth` is `max_z - min_z`.

  + `dataLayers.wkwResolutions`: Holds information about the available magnification steps of the layer.
    * `dataLayers.wkwResolutions.resolution`: Either a scalar integer (e.g. `1`, `2` or `4`) or a 3-tuple (e.g. `2, 2, 1`) for non-uniform magnifications.
    * `dataLayers.wkwResolutions.cubeLength`: The cube size of the WKW cube files. Usually is `1024`.

  + `dataLayers.elementClass`: The underlying datatype of the layer, e.g. `uint8`, `uint16` or `float32`.
  + `dataLayers.largestSegmentId`: The highest ID that is currently used in the respective segmentation layer. This is required for volume annotations where new objects with incrementing IDs are created. Only applies to segmentation layers.
  + `dataLayers.dataFormat`: Should be `wkw`.

### Converting with webKnossos Cuber

#### Image Stacks
If you have image stacks (e.g. tiff stacks), you can easily convert them with [webKnossos cuber](https://github.com/scalableminds/webknossos-libs/tree/master/wkcuber).
The tool expects all image files in a single folder with numbered file names.
After installing, you can create simple WKW datasets with the following command:

```
python -m wkcuber \
  --layer_name color \
  --scale 11.24,11.24,25 \
  --name great_dataset \
  data/source/color data/target
```

This snippet converts an image stack that is located at `data/source/color` into a WKW dataset which will be located at `data/target`.
It will create the `color` layer.
You need to supply the `scale` parameter which is the size of one voxel in nanometers.

Read the full documentation at [webKnossos cuber](https://github.com/scalableminds/webknossos-libs/tree/master/wkcuber).
[Please contact us](mailto:hello@webknossos.org) or [write a post](https://forum.image.sc/tag/webknossos), if you have any issues with converting your dataset.

#### KNOSSOS Cubes

Datasets saved as KNOSSOS cubes can be easily converted with the [webKnossos cuber](https://github.com/scalableminds/webknossos-libs/tree/master/wkcuber) tool.

#### Import Datasets

After the manual conversion, proceed with the remaining import step.
See the [Datasets guide](./datasets.md#Importing) for further instructions.

#### NML Files
When working with skeleton annotation data, webKnossos uses the NML format.
It can be downloaded from and uploaded to webKnossos, and used for processing in your scripts.
NML is an XML-based, human-readable file format.
See the following example for reference:

```xml
<things>
  <parameters>
    <experiment name="great_dataset" />
    <scale x="11.24" y="11.24" z="25.0" />
    <offset x="0" y="0" z="0" />
    <time ms="1534787309180" />
    <editPosition x="1024" y="1024" z="512" />
    <editRotation xRot="0.0" yRot="0.0" zRot="0.0" />
    <zoomLevel zoom="1.0" />
  </parameters>
  <thing id="1" groupId="2" color.r="0.0" color.g="0.0" color.b="1.0" color.a="1.0" name="explorative_2018-08-20_Example">
    <nodes>
      <node id="1" radius="120.0" x="1475" y="987" z="512" rotX="0.0" rotY="0.0" rotZ="0.0" inVp="0" inMag="0" bitDepth="8" interpolation="false" time="1534787309180" />
      <node id="2" radius="120.0" x="1548" y="1008" z="512" rotX="0.0" rotY="0.0" rotZ="0.0" inVp="0" inMag="0" bitDepth="8" interpolation="false" time="1534787309180" />
    </nodes>
    <edges>
      <edge source="1" target="2" />
    </edges>
  </thing>
  <branchpoints>
    <branchpoint id="1" time="1534787309180" />
  </branchpoints>
  <comments>
    <comment node="2" content="This is a really interesting node" />
  </comments>
  <groups>
    <group id="1" name="Axon 1">
        <group id="2" name="Foo" />
    </group>
  </groups>
</things>

```

Each NML contains some metadata about the annotation inside the `<parameters>`-tag. 
An example of important metadata is the dataset name inside the `<experiment>`-tag and the scale of the dataset saved in the `<scale>`-tag.
Each skeleton tree has its own `<thing>`-tag containing a list of its nodes and edges.
All comments of the skeleton annotation are saved in a separate list and refer to their corresponding nodes by id.
The structure of the tree groups is listed inside the `<groups>`-tag. 
Groups can be freely nested inside each other.


// todo
### ID Mapping Files

 and need to follow this schema. All segment IDs belonging to the same super-voxel need to be listed in an array:  
```
{
  {
    "name": "astrocytes",
    "classes": [
      [
        69381,
        69445,
        138248
      ],
      [
        138307,
        343831
      ],
      [
        348348,
        132432,
        387433,
        338330
      ]
    ]
  }
}
```