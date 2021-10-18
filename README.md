# [webKnossos](https://webknossos.org/)
<img align="right" src="https://static.webknossos.org/images/oxalis.svg" alt="webKnossos Logo" />
webKnossos is an open-source tool for annotating and exploring large 3D image datasets.

* Fly through your data for fast skeletonization and proof-reading
* Create 3D training data for automated segmentations efficiently
* Scale data reconstruction projects with crowdsourcing workflows
* Share datasets and annotations with collaborating scientists

[Start using webKnossos](https://webknossos.org) - [On your own server](https://docs.webknossos.org/) - [User Documentation](https://docs.webknossos.org) - [Contact us](mailto:hello@webknossos.org)

[![](https://img.shields.io/circleci/project/github/scalableminds/webknossos/master.svg?logo=circleci)](https://circleci.com/gh/scalableminds/webknossos)
[![](https://img.shields.io/github/release/scalableminds/webknossos.svg)](https://github.com/scalableminds/webknossos/releases/latest)
[![](https://img.shields.io/github/license/scalableminds/webknossos.svg?colorB=success)](https://github.com/scalableminds/webknossos/blob/master/LICENSE)
[![Twitter](https://img.shields.io/twitter/url/http/webknossos.svg?style=social)](https://twitter.com/webknossos)

## Demo
[https://webknossos.org/](https://webknossos.org/)

## Features
* Exploration of large 3D image datasets
* Fully browser-based user experience with efficient data streaming
* Creation/editing of skeleton and volume annotations
* [Innovative flight mode for fast skeleton tracing](https://www.nature.com/articles/nmeth.4331)
* Optimized performance for large tracings
* User and task management for high-throughput crowdsourcing
* Sharing and collaboration features
* [Standalone datastore component](https://github.com/scalableminds/webknossos/tree/master/webknossos-datastore) for flexible deployments
* [Supported dataset formats: WKW](https://github.com/scalableminds/webknossos/wiki/Datasets), [Neuroglancer Precomputed, and BossDB](https://github.com/scalableminds/webknossos-connect)
* Supported image formats: Grayscale, Segmentation Maps, RGB, Multi-Channel
* [Support for 3D mesh rendering and on-the-fly isosurface generation](https://docs.webknossos.org/guides/mesh_visualization)
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
webKnossos is open-source, so you can install it on your own server.

[Check out the documentation](https://docs.webknossos.org/guides/installation) for a tutorial on how to install webKnossos on your own server.

For installations on localhost, please see below.

## Development installation
### Docker
This is only recommended for local testing. Docker 17+ and Docker Compose 1.18+ are required.

```bash
git clone -b master --depth=1 git@github.com:scalableminds/webknossos.git
cd webknossos
docker-compose pull webknossos
./start-docker.sh
```

Open your local webknossos instance on [localhost:9000](http://localhost:9000) and complete the onboarding steps in the browser.
Now, you are ready to use your local webKnossos instance.

See the wiki for [instructions on updating](https://github.com/scalableminds/webknossos/wiki/Development-setup) this development setup.

For non-localhost deployments, check out the [installation guide in the documentation](https://docs.webknossos.org/guides/installation).

### Dependencies

* [Oracle JDK 8+](http://www.oracle.com/technetwork/java/javase/downloads/index.html) or [Open JDK 8+](http://openjdk.java.net/) (full JDK, JRE is not enough)
* [sbt](http://www.scala-sbt.org/)
* [PostgreSQL 10+](https://www.postgresql.org/)
* [Redis 5+](https://redis.io/)
* [node.js 12+](http://nodejs.org/download/)
* [yarn package manager](https://yarnpkg.com/)
* [git](http://git-scm.com/downloads)

### OS X
If you are using OS X try using this awesome installer:
https://gist.github.com/normanrz/9128496

Or install Java manually and run:

```bash
# Install Homebrew package manager
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

# Install git, node.js, postgres, sbt, gfind, gsed
brew install git node postgresql sbt findutils coreutils gnu-sed redis
npm install -g yarn

# Start postgres
brew services start postgresql

# Create PostgreSQL user
createdb
psql -c "CREATE DATABASE webknossos;"
psql -c "CREATE USER postgres WITH ENCRYPTED PASSWORD 'postgres';"
psql -c "ALTER USER postgres WITH SUPERUSER;"
psql -c "GRANT ALL PRIVILEGES ON DATABASE webknossos TO postgres;"

# Checkout the webKnossos git repository
git clone git@github.com:scalableminds/webknossos.git
```


### Ubuntu 20.04 LTS

```bash
sudo apt install -y curl ca-certificates
# Adding repositories for nodejs, sbt and yarn
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
echo "deb https://repo.scala-sbt.org/scalasbt/debian all main" | sudo tee /etc/apt/sources.list.d/sbt.list
echo "deb https://repo.scala-sbt.org/scalasbt/debian /" | sudo tee /etc/apt/sources.list.d/sbt_old.list
curl -sL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x2EE0EA64E40A89B84B2DF73499E82A75642AC823" | sudo apt-key add
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list

sudo apt update
sudo apt install -y nodejs git postgresql postgresql-client scala sbt openjdk-8-jdk yarn redis-server

# Assign a password to PostgreSQL user
sudo -u postgres psql -c "ALTER USER postgres WITH ENCRYPTED PASSWORD 'postgres';"
# Clone the git repo to the current directory
git clone -b master --depth=1 git@github.com:scalableminds/webknossos.git
```

If you already have a different Java version installed, set the default version to Java 8:
- run `sudo update-alternatives --config java`
- when prompted, select the desired version

On older Ubuntu distributions: Please make sure to have the correct versions of node, PostgreSQL and java installed.

### Manual Installation

##### Java
* Install Java JDK 8 (from Oracle or OpenJDK)
* make sure `JAVA_HOME` and `JDK_HOME` are set and `PATH` contains path to JDK

##### sbt
See: http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html

##### PostgreSQL
* Install PostgreSQL from https://www.postgresql.org/download/
* PostgreSQL version **10+ is required**

##### Redis
* Install Redis from https://redis.io/download

##### node.js & yarn
* Install node from http://nodejs.org/download/
* node version **12+ is required**
* Install yarn package manager: `npm install -g yarn`

### Run locally

First, install all frontend dependencies via
```bash
yarn install
```
Note: During this installation step, it might happen that the module `gl` cannot be installed correctly. As this module is only used for testing webKnossos, you can safely ignore this error.

To start webKnossos, use
```bash
yarn start
```
This will fetch all Scala, Java and node dependencies and run the application on Port 9000.
Make sure that the PostgreSQL and Redis services are running before you start the application.

## Upgrades
For upgrades, please check the [changelog](CHANGELOG.released.md) & [migration guide](MIGRATIONS.released.md).

## Tests
```bash
# Frontend linting
yarn run lint

# Format frontend code
yarn run pretty

# Frontend type checking
yarn flow

# Frontend tests
yarn test-verbose

# End-to-end tests
docker-compose run e2e-tests
```


## Contact and support
Ask for help in the [image.sc community forum](https://forum.image.sc/tag/webknossos).

Contact us at [hello@webknossos.org](mailto:hello@webknossos.org).

[scalable minds](https://scalableminds.com) offers commercial hosting, support and development services for webKnossos.

## Credits
* scalable minds - https://scalableminds.com/
* Max Planck Institute for Brain Research – https://brain.mpg.de/

webKnossos was inspired by [KNOSSOS](https://knossos.app).

### Thanks
* [CircleCI](https://circleci.com/gh/scalableminds/webknossos) for letting us run builds and tests on their CI
* [Browser Stack](https://www.browserstack.com/) for letting us test WebKnossos on a variety of different devices
<a href="https://www.browserstack.com/"><img src="https://p14.zdusercontent.com/attachment/1015988/wustfygoUpQ0faC7tIiaOpJUM?token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..TpDEVjDPeSTDWdmL0pu6Mw.pdawodFlbAuP4ZbKn5Ucpyq69pCh3bUXv_XH_yJk7CdAzi6IIi7Az6VWriflXVKOyTWtqA8JkxqPu11s9R56jC2I5JwCc1DJILtD_j9fT4rAIth-hvnST0eA_LqBdXpRYKMHtxookA-dZ9pbvHBTFb-JG2PEKl1IXZCw5GlIRgW2Oxieg9xXtFpBN7R6_Q5yRiwuviemrK0ide1ygC8HTMDgdgdbCLuhHDDeNyluU7tR9kVtV7KZDsVd2WIBId-fSyzInofDhlk196_fHwR0WQd1pN7GDVIdfRhxTTTNWTw.g0PCM6T1kBG7AtBwKZmfzQ" width=100 alt="Browserstack Logo"></a>

# License
AGPLv3
