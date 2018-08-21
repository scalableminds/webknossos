# webKnossos
Cellular-resolution connectomics is currently substantially limited by the throughput and efficiency of data analysis. 
Current solutions require an efficient integration of automated image analysis with massive manual data annotation. 
To scale such annotation efforts it is decisive to be able to crowd source data analysis online. 
Here we present **webKnossos**.

> Boergens, Berning, Bocklisch, Bräunlein, Drawitsch, Frohnhofen, Herold, Otto, Rzepka, Werkmeister, Werner, Wiese, Wissler and Helmstaedter  
webKnossos: efficient online 3D data annotation for connectomics.  
[Nature Methods (2017) DOI:10.1038/NMETH.4331.](https://www.nature.com/articles/nmeth.4331)

![webKnossos logo](https://webknossos.brain.mpg.de/assets/images/oxalis.svg)
[![CircleCI](https://circleci.com/gh/scalableminds/webknossos.svg?style=svg)](https://circleci.com/gh/scalableminds/webknossos)


## Demo
Featured Dataset gallery: [https://demo.webknossos.org/](https://demo.webknossos.org/)

Try webKnossos yourself: [https://try.webknossos.org/](https://try.webknossos.org/)

## Features
* Exploration of large 3D image datasets
* Fully browser-based user experience with efficient data streaming
* Creation/editing of [skeleton and volume annotations](./tracing_ui.md)
* [Innovative flight mode for fast skeleton tracing](https://www.nature.com/articles/nmeth.4331)
* Optimized performance for large datasets and annotations
* [User and task management](./users.md) for high-throughput crowdsourcing
* [Sharing and collaboration](./sharing.md) features
* Efficient [keyboard shortcuts](./keyboard_shortcuts.md)
* [Standalone datastore component](https://github.com/scalableminds/webknossos/tree/master/webknossos-datastore) for flexible deployments
* [Supported dataset formats](./datasets.md): WKW (Optimized), KNOSSOS cubes
* [Supported image formats](./data_formats.md): Grayscale, Segmentation Maps, RGB, Multi-Channel
* [Documented frontend API for user scripts](https://demo.webknossos.org/assets/docs/frontend-api/index.html), REST API for backend access
* Open-source development with [automated test suite](https://circleci.com/gh/scalableminds/webknossos)
* [Docker-based deployment](https://hub.docker.com/r/scalableminds/webknossos/) for production and development
