# [WEBKNOSSOS](https://webknossos.org/)
<img align="right" src="https://raw.githubusercontent.com/scalableminds/webknossos/master/public/images/logo-icon-only.svg" alt="WEBKNOSSOS Logo" width="150" />
WEBKNOSSOS is an open-source tool for annotating and exploring large 3D image datasets.

* Fly through your data for fast skeletonization and proofreading
* Create 3D training data for automated segmentations efficiently
* Scale data reconstruction projects with crowdsourcing workflows
* Share datasets and annotations with collaborating scientists

[Start using WEBKNOSSOS](https://webknossos.org) - [On your own server](https://docs.webknossos.org/webknossos/installation.html) - [User Documentation](https://docs.webknossos.org) - [Contact us](mailto:hello@webknossos.org)

[![](https://img.shields.io/circleci/project/github/scalableminds/webknossos/master.svg?logo=circleci)](https://circleci.com/gh/scalableminds/webknossos)
[![](https://img.shields.io/github/release/scalableminds/webknossos.svg)](https://github.com/scalableminds/webknossos/releases/latest)
[![](https://img.shields.io/github/license/scalableminds/webknossos.svg?colorB=success)](https://github.com/scalableminds/webknossos/blob/master/LICENSE)
[![Twitter](https://img.shields.io/twitter/url/http/webknossos.svg?style=social)](https://twitter.com/webknossos)

## Website and hosted version
[https://webknossos.org](https://webknossos.org/)

## Features
* Exploration of large 3D image datasets
* Fully browser-based user experience with efficient data streaming
* Creation/editing of skeleton and volume annotations
* [Innovative flight mode for fast skeleton annotation](https://www.nature.com/articles/nmeth.4331)
* Optimized performance for large annotations
* User and task management for high-throughput crowdsourcing
* Sharing and collaboration features
* Proofreading tools for working with large (over)-segmentations
* [Standalone datastore component](https://github.com/scalableminds/webknossos/tree/master/webknossos-datastore) for flexible deployments
* Supported dataset formats: [WKW](https://github.com/scalableminds/webknossos-wrap), [Neuroglancer Precomputed](https://github.com/google/neuroglancer/tree/master/src/datasource/precomputed), [Zarr](https://zarr.dev), [N5](https://github.com/saalfeldlab/n5)
* Supported image formats: Grayscale, Segmentation Maps, RGB, Multi-Channel
* [Support for 3D mesh rendering and ad-hoc mesh generation](https://docs.webknossos.org/webknossos/mesh_visualization.html)
* Export and streaming of any dataset and annotation as [Zarr](https://zarr.dev) to third-party tools
* [Documented frontend API for user scripts](https://webknossos.org/assets/docs/frontend-api/index.html), REST API for backend access
* Open-source development with [automated test suite](https://circleci.com/gh/scalableminds/webknossos)
* [Docker-based deployment](https://hub.docker.com/r/scalableminds/webknossos/) for production and development
* [Detailed Documentation](https://docs.webknossos.org)

## Publication
> Boergens, Berning, Bocklisch, Bräunlein, Drawitsch, Frohnhofen, Herold, Otto, Rzepka, Werkmeister, Werner, Wiese, Wissler and Helmstaedter
> webKnossos: efficient online 3D data annotation for connectomics.
> [Nature Methods (2017) DOI:10.1038/NMETH.4331.](https://www.nature.com/articles/nmeth.4331)

[Read more about the original publication.](https://publication.webknossos.org)

## Installation
WEBKNOSSOS is open-source, so you can install it on your own server.

[Check out the documentation](https://docs.webknossos.org/webknossos/open_source/installation.html) for a tutorial on how to install WEBKNOSSOS on your own server.

For development installations, please see `DEV_INSTALL.md` file.

## Contributions, Contact and Support
We welcome community feedback and contributions! We are happy to have

* [general feedback, observations and questions](#feedback-observations-and-questions) on the [image.sc forum](https://forum.image.sc/tag/webknossos),
* [feature suggestions and bug reports](#issues-feature-suggestions-and-bug-reports) as [issues on GitHub](https://github.com/scalableminds/webknossos/issues/new),
* [documentation, examples and code contributions](#pull-requests-docs-and-code-contributions) as [pull requests on GitHub](https://github.com/scalableminds/webknossos/compare).

For details on community contributions, please refer to our [Contributing guide](./Contributing_Guide.md).

Contact us at [hello@webknossos.org](mailto:hello@webknossos.org).

[scalable minds](https://scalableminds.com) offers commercial hosting, support and development services for WEBKNOSSOS.


## Credits
* scalable minds - https://scalableminds.com/
* Max Planck Institute for Brain Research – https://brain.mpg.de/

WEBKNOSSOS was inspired by [KNOSSOS](https://knossos.app).

### Thanks
* [Browser Stack](https://www.browserstack.com/) for letting us test WEBKNOSSOS on a variety of different devices
  <a href="https://www.browserstack.com/"><img src="https://avatars.githubusercontent.com/u/1119453?s=200&v=4" width=100 alt="Browserstack Logo" align="right"></a>
* [CircleCI](https://circleci.com/gh/scalableminds/webknossos) for letting us run builds and tests on their CI

# License
AGPLv3
