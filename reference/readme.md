# Code Readme

## webKnossos

Cellular-resolution connectomics is currently substantially limited by the throughput and efficiency of data analysis. Current solutions require an efficient integration of automated image analysis with massive manual data annotation. To scale such annotation efforts it is decisive to be able to crowd source data analysis online. Here we present **webKnossos**.

> Boergens, Berning, Bocklisch, Bräunlein, Drawitsch, Frohnhofen, Herold, Otto, Rzepka, Werkmeister, Werner, Wiese, Wissler and Helmstaedter webKnossos: efficient online 3D data annotation for connectomics. [Nature Methods \(2017\) DOI:10.1038/NMETH.4331.](https://www.nature.com/articles/nmeth.4331)

![webKnossos logo](https://webknossos.org/images/oxalis.svg)

[![CircleCI](https://circleci.com/gh/scalableminds/webknossos.svg?style=svg)](https://circleci.com/gh/scalableminds/webknossos)

### Demo

[https://demo.webknossos.org/](https://demo.webknossos.org/)

### Features

* Exploration of large 3D image datasets
* Fully browser-based user experience with efficient data streaming
* Creation/editing of skeleton and volume annotations
* [Innovative flight mode for fast skeleton tracing](https://www.nature.com/articles/nmeth.4331)
* Optimized performance for large tracings
* User and task management for high-throughput crowdsourcing
* Sharing and collaboration features
* [Standalone datastore component](https://github.com/scalableminds/webknossos/tree/master/webknossos-datastore) for flexible deployments
* [Supported dataset formats: WKW \(Optimized\), KNOSSOS cubes](https://github.com/scalableminds/webknossos/wiki/Datasets)
* Supported image formats: Grayscale, Segmentation Maps, RGB, Multi-Channel
* [Documented frontend API for user scripts](https://demo.webknossos.org/assets/docs/frontend-api/index.html), REST API for backend access
* Open-source development with [automated test suite](https://circleci.com/gh/scalableminds/webknossos)
* [Docker-based deployment](https://hub.docker.com/r/scalableminds/webknossos/) for production and development

### Development setup

#### Docker

This is the fastest way to try webKnossos. Docker CE 17+ and Docker Compose 1.18+ is required. This is only recommended for testing. [For production](https://github.com/scalableminds/webknossos/wiki/Production-setup), a more elaborate setup with persistent file mounts and HTTPS reverse proxy is recommended.

```bash
docker-compose pull webknossos
./start-docker.sh
```

See the [wiki](https://github.com/scalableminds/webknossos/wiki/Try-setup) for instructions on updating this try setup.

#### Dependencies

* [Oracle JDK 8+](http://www.oracle.com/technetwork/java/javase/downloads/index.html) or [Open JDK 8+](http://openjdk.java.net/) \(full JDK, JRE is not enough\)
* [sbt](http://www.scala-sbt.org/)
* [PostgreSQL 10](https://www.postgresql.org/)
* [node.js 9+](http://nodejs.org/download/)
* [yarn package manager](https://yarnpkg.com/)
* [git](http://git-scm.com/downloads)

#### OS X

If you are using OS X try using this awesome installer: [https://gist.github.com/normanrz/9128496](https://gist.github.com/normanrz/9128496)

Or install Java manually and run:

```bash
# Install Homebrew package manager
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

# Install git, node.js, postgres, sbt, gfind, gsed
brew install git node postgresql sbt findutils coreutils gnu-sed
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

#### Ubuntu 16.04 LTS

```bash
# Adding repositories for sbt, nodejs and yarn
echo "deb https://dl.bintray.com/sbt/debian /" | sudo tee /etc/apt/sources.list.d/sbt.list
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 642AC823
echo "deb http://apt.postgresql.org/pub/repos/apt/ xenial-pgdg main" | sudo tee /etc/apt/sources.list.d/postgresql.list
curl -sS https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
curl -sL https://deb.nodesource.com/setup_9.x | sudo -E bash -
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list

# Installing everything
sudo apt-get update
sudo apt-get install -y git postgresql-10 postgresql-client-10 nodejs scala sbt openjdk-8-jdk yarn

# Assign a password to PostgreSQL user
sudo -u postgres psql -c "ALTER USER postgres WITH ENCRYPTED PASSWORD 'postgres';"
```

On older Ubuntu distributions: Please make sure to have the correct versions of node, PostgreSQL and java installed.

#### Manual Installation

**Java**

* Install Java JDK 8 \(from Oracle or OpenJDK\)
* make sure `JAVA_HOME` and `JDK_HOME` are set and `PATH` contains path to JDK

**sbt**

See: [http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html](http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html)

**PostgreSQL**

* Install PostgreSQL from [https://www.postgresql.org/download/](https://www.postgresql.org/download/)
* PostgreSQL version **10+ is required**

**node.js & yarn**

* Install node from [http://nodejs.org/download/](http://nodejs.org/download/)
* node version **9+ is required**
* Install yarn package manager: `npm install -g yarn`

#### Run locally

```bash
yarn start
```

Will fetch all Scala, Java and node dependencies and run the application on Port 9000. Make sure that the PostgreSQL service is running before you start the application.

### Production setup

[See wiki](https://github.com/scalableminds/webknossos/wiki/Production-setup) for recommended production setup.

For upgrades, please check the [changelog](changelog.md) & [migration guide](migrations.md).

### Tests

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

### Contact and support

Contact us at [hello@scalableminds.com](mailto:hello@scalableminds.com).

[scalable minds](https://scalableminds.com) offers commercial hosting, support and development services for webKnossos.

### Credits

* scalable minds - [https://scalableminds.com/](https://scalableminds.com/)
* Max Planck Institute for Brain Research – [https://brain.mpg.de/](https://brain.mpg.de/)

webKnossos was inspired by [KNOSSOS](https://knossos.app).

#### Thanks

* [CircleCI](https://circleci.com/gh/scalableminds/webknossos) for letting us run builds and tests on their CI
* [Browser Stack](https://www.browserstack.com/) for letting us test WebKnossos on a variety of different devices

## License

AGPLv3

