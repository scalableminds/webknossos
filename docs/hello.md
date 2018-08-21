# Welcome to webKnossos

TODO: Friendly intro

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
Dataset gallery: [https://demo.webknossos.org/](https://demo.webknossos.org/)  
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

## Screenshots/Walkthrough

TODO

## Credits and Help

webKnossos was developed by [scalable minds](https://scalableminds.com) in collaboration with the [Max Planck Institute for Brain Research](https://brain.mpg.de/connectomics).

If you need help with webKnossos, there is a [Community Support forum](https://support.webknososs.org) where members of the community and scalable minds are happy to answer your questions.
[scalable minds](https://scalableminds.com) also offers commercial support, managed hosting and feature development services.
[Please contact us](mailto:hello@scalableminds.com) if you want to learn more.

<!--
## Labs that use webKnossos

* [Helmstaedter Lab, Max Planck Institute for Brain Research](http://brain.mpg.de/research/helmstaedter-department.html)
* [Briggman Lab, Caesar Institute](https://www.caesar.de/en/our-research/computational-neuroethology/research-focus.html)
* [Schaefer Lab, The Francis Crick Institute](https://www.crick.ac.uk/research/labs/andreas-schaefer)
* [Singer Lab, University of Maryland](http://biology.umd.edu/joshua-singer.html)

[Please let us know](mailto:hello@scalableminds.com), if you'd like to add your lab to the list.
-->
