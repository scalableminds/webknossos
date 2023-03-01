# Tooling
We provide several free, open-source libraries and tools alongside WEBKNOSSOS to aid with data analysis. 
 
## WEBKNOSSOS Python Library
- [webknossos-libs](https://github.com/scalableminds/webknossos-libs)
- [Read The Docs](https://docs.webknossos.org/webknossos-py/index.html)
- Our official Python library for working with WEBKNOSSOS datasets, skeleton and volume annotations and for downloading/uploading data from your WEBKNOSSOS instance through the REST API.
- Read & write WEBKNOSSOS datasets and *.wkw files (raw image data and volume segmentations)
- Read & write *.nml files (skeleton annotations)
- Download, modify and upload datasets to WEBKNOSSOS


## WEBKNOSSOS Cuber
- [webknossos-libs/wkcuber](https://github.com/scalableminds/webknossos-libs/wkcuber)
- [Read The Docs](https://docs.webknossos.org/wkcuber/index.html)
- CLI tool for converting (volume) image data into [webKnossos-wrap datasets]() (*.wkw) and vice-versa
- Supports TIFF stacks, jpeg, dm3, Knossos Cubes, tiled images stacks (e.g. Catmaid) and many more
- [Read more about the support data formats](./data_formats.md)


## WEBKNOSSOS Connect
- [https://github.com/scalableminds/webknossos-connect](https://github.com/scalableminds/webknossos-connect)
- A WEBKNOSSOS compatible data connector written in Python
- WEBKNOSSOS-connect serves as an adapter between the WEBKNOSSOS data store interface and other alternative data storage servers (e.g., BossDB) or static files hosted on Cloud Storage (e.g. Neuroglancer Precomputed)


## webKnossos Wrap Data Format (wkw)
- [webknossos-wrap](https://github.com/scalableminds/webknossos-wrap)
- Library for low-level read and write operations to wkw datasets
- Use the [WEBKNOSSOS Python API](https://github.com/scalableminds/webknossos-libs) above for easy-to-use, high-level access to wkw datasets
- Available for Python, MATLAB, C/C++, and others 


## MATLAB NML Functions
- [https://github.com/mhlabCodingTeam/SegEM/tree/master/auxiliaryMethods](https://github.com/mhlabCodingTeam/SegEM/tree/master/auxiliaryMethods)
- MATLAB utilities and functions for working with NML skeletons provided as part of the SegEM publication
- Developed by [Connectomics Department at Max-Planck-Institute for Brain Research](https://brain.mpg.de/helmstaedter)
