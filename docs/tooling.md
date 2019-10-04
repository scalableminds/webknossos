# Tooling

We provide a number of free, open-source libraries and tools alongside webKnossos to aid with data analysis. 


## webKnossos Wrap Data Format (wkw)
- [https://github.com/scalableminds/webknossos-wrap](https://github.com/scalableminds/webknossos-wrap)
- Library to read and write wkw datasets
- Available for Python, MATLAB, C/C++, and others 

## webKnossos Connect
- [https://github.com/scalableminds/webknossos-connect](https://github.com/scalableminds/webknossos-connect)
- A webKnossos compatible data connector written in Python
- webKnossos-connect serves as an adapter between the webKnossos data store interface and other alternative data storage servers (e.g BossDB) or static files hosted on Cloud Storage (e.g. Neuroglancer Precomputed)

## webKnossos Cuber
- [https://github.com/scalableminds/webknossos-cuber](https://github.com/scalableminds/webknossos-cuber)
- Converts image stacks into [webKnossos-wrap dataset]() (*.wkw) and vice-versa
- Supports TIFFs, jpeg, Knossos Cubes, tiled images stacks (e.g. Catmaid)
- [Read more about the support data formats](./data_formats.md)


## wkNML
- [https://github.com/scalableminds/wknml](https://github.com/scalableminds/wknml)
- Python library for reading and writing webKnossos [NML skeleton files](./data_formats.md#nml)

## MATLAB NML Functions
- [https://github.com/mhlabCodingTeam/SegEM/tree/master/auxiliaryMethods](https://github.com/mhlabCodingTeam/SegEM/tree/master/auxiliaryMethods)
- MATLAB utilities and function for working with NML skeletons provided as part of the SegEM publication
