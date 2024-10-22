# Neuroglancer Precomputed

WEBKNOSSOS can read [Neuroglancer precomputed datasets](https://github.com/google/neuroglancer/tree/master/src/neuroglancer/datasource/precomputed).

Neuroglancer Precomputed datasets can both be uploaded to WEBKNOSSOS through the [web uploader](./upload_ui.md) or [streamed from a remote server or the cloud](./streaming.md).

## Examples

You can try the Neuroglancer Precomputed support with the following datasets. Load them in WEBKNOSSOS as a [remote dataset](./streaming.md): 


- Mouse Cortex EM data hosted on Google Cloud Storage
    - `gs://iarpa_microns/minnie/minnie65/em`
    - Source: MICrONs Consortium et al. Functional connectomics spanning multiple areas of mouse visual cortex. bioRxiv 2021.07.28.454025; doi: [https://doi.org/10.1101/2021.07.28.454025](https://doi.org/10.1101/2021.07.28.454025)
- FlyEM Hemibrain hosted on Google Cloud Storage
    - `gs://neuroglancer-janelia-flyem-hemibrain/emdata/clahe_yz/jpeg`
    - `gs://neuroglancer-janelia-flyem-hemibrain/v1.0/segmentation`
    - Source: [https://www.janelia.org/project-team/flyem/hemibrain](https://www.janelia.org/project-team/flyem/hemibrain)
- Interphase HeLa cell EM data hosted on AWS S3
    - `s3://janelia-cosem-datasets/jrc_hela-3/neuroglancer/em/fibsem-uint8.precomputed` 
    - Source: [Open Organelle Project](https://openorganelle.janelia.org/datasets/jrc_hela-3)


## Neuroglancer Precomputed folder structure

WEBKNOSSOS expects the following file structure for Neuroglancer Precomputed datasets:

```
my_dataset.precomputed             # One root folder per dataset
├─ info                            # Dataset [metadata in JSON format](https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/volume.md#info-json-file-specification)
├─ scale_1                         # One subdirectory with the same name as each scale/magnification "key" value specified in the info file. Each subdirectory contains a chunked representation of the data for a single resolution (meaning single magnification/mag for WEBKNOSSOS).
│  ├─ <chunks>
│  └─ ...
├─ ...                  
└─ scale_n                  
```

For details see the [Neuroglancer spec](https://github.com/google/neuroglancer/tree/master/src/neuroglancer/datasource/precomputed).

## Performance Considerations
To get the best streaming performance for Neuroglancer Precomputed datasets consider the following settings.

- Use chunk sizes of 32 - 128 voxels^3
- Enable sharding
