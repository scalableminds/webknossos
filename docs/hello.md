# Welcome to webKnossos

webKnossos is an [open-source tool](https://github.com/scalableminds/webknossos) for [exploring](../guides/tracing_ui.md) large 3D electron-microscopy \(EM\) and light-microscopy \(LM\) datasets as well as [collaboratively](../guides/sharing.md) generating annotations. The web-based tool is powered by a specialized data-delivery backend that stores [large datasets](../guides/datasets.md) efficiently on disk and serves many concurrent users. webKnossos has a GPU-accelerated viewer that includes tools for creating and sharing annotations \(skeletons and volumes\). Powerful [user](../guides/users.md) and [task](../guides/tasks.md) management features automatically distribute tasks to human annotators. There are a lot of productivity improvements to make the human part as efficient as possible. webKnossos is also a platform for [showcasing datasets](https://demo.webknossos.org) alongside a paper publication.

> Boergens, Berning, Bocklisch, Bräunlein, Drawitsch, Frohnhofen, Herold, Otto, Rzepka, Werkmeister, Werner, Wiese, Wissler and Helmstaedter  
> webKnossos: efficient online 3D data annotation for connectomics.  
> [Nature Methods \(2017\) DOI:10.1038/NMETH.4331.](https://www.nature.com/articles/nmeth.4331)

![webKnossos logo](https://webknossos.brain.mpg.de/assets/images/oxalis.svg)

## Demo

Dataset gallery: [https://demo.webknossos.org/](https://demo.webknossos.org/)  
Try webKnossos yourself: [https://try.webknossos.org/](https://try.webknossos.org/)

## Features

* Exploration of large 3D image datasets
* Fully browser-based user experience with efficient data streaming
* Creation/editing of [skeleton and volume annotations](../guides/tracing_ui.md)
* [Innovative flight mode for fast skeleton tracing](https://www.nature.com/articles/nmeth.4331)
* Optimized performance for large datasets and annotations
* [User](../guides/users.md) and [task](../guides/tasks.md) management for high-throughput crowdsourcing
* [Sharing and collaboration](../guides/sharing.md) features
* Efficient [keyboard shortcuts](../reference/keyboard_shortcuts.md)
* Undo/Redo functionality
* [Standalone datastore component](https://github.com/scalableminds/webknossos/tree/master/webknossos-datastore) for flexible deployments
* [Supported dataset formats](../guides/datasets.md): WKW \(Optimized\), KNOSSOS cubes
* [Supported image formats](../reference/data_formats.md): Grayscale, Segmentation Maps, RGB, Multi-Channel
* [Documented frontend API for user scripts](https://demo.webknossos.org/assets/docs/frontend-api/index.html), REST API for backend access
* Open-source development with [automated test suite](https://circleci.com/gh/scalableminds/webknossos)
* [Docker-based deployment](https://hub.docker.com/r/scalableminds/webknossos/) for production and development

## Screenshots

![Skeleton Annotations](../.gitbook/assets/tracing_ui_skeleton%20%281%29.png) ![Volume Annotations](../.gitbook/assets/tracing_ui_volume%20%282%29.png) ![Flight Mode](../.gitbook/assets/tracing_ui_flight.png) ![Managing Datasets](../.gitbook/assets/dashboard_datasets.png) ![Working on Tasks](../.gitbook/assets/dashboard_tasks%20%283%29.png) ![Showcasing Datasets](../.gitbook/assets/spotlight.png)

## Credits and Help

webKnossos was developed by [scalable minds](https://scalableminds.com) in collaboration with the [Max Planck Institute for Brain Research](https://brain.mpg.de/connectomics).

If you need help with webKnossos, there is a [Community Support forum](https://support.webknososs.org) where members of the community and scalable minds are happy to answer your questions. [scalable minds](https://scalableminds.com) also offers commercial support, managed hosting and feature development services. [Please contact us](mailto:hello@scalableminds.com) if you want to learn more.

