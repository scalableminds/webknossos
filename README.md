# webKnossos
Cellular-resolution connectomics is currently substantially limited by the throughput and efficiency of data analysis. Current solutions require an efficient integration of automated image analysis with massive manual data annotation. To scale such annotation efforts it is decisive to be able to crowd source data analysis online. Here we present **webKnossos** (former oxalis).

![webKnossos logo](https://webknossos.brain.mpg.de/assets/images/oxalis.svg)
[![CircleCI](https://circleci.com/gh/scalableminds/webknossos.svg?style=svg)](https://circleci.com/gh/scalableminds/webknossos)

## Development setup
If you are installing *webKnossos* in a virtual machine, please make sure you allocated **enough memory**. A good value is 5 GB.

### Dependencies

* [Oracle JDK 8+](http://www.oracle.com/technetwork/java/javase/downloads/index.html) or [Open JDK 8+](http://openjdk.java.net/) (full JDK, JRE is not enough)
* [sbt](http://www.scala-sbt.org/)
* [PostgreSQL 10](https://www.postgresql.org/)
* [node.js 9+](http://nodejs.org/download/)
* [yarn package manager](https://yarnpkg.com/)
* [git](http://git-scm.com/downloads)

### OS X
If you are using OS X try using this awesome installer:
https://gist.github.com/normanrz/9128496

Or install Java manually and run:

```bash
# Install Homebrew package manager
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

# Install git, node.js, mongoDB, sbt, gfind
brew install git node postgresql sbt findutils coreutils
npm install -g yarn

# Start mongo
brew services start postgresql

# Create PostgreSQL user
CREATE DATABASE webknossos;
CREATE USER postgres WITH ENCRYPTED PASSWORD 'postgres';
GRANT ALL PRIVILEGES ON DATABASE webknossos TO postgres;

# Checkout the webKnossos git repository
git clone git@github.com:scalableminds/webknossos.git
```


### Ubuntu 16.04 LTS

```
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
sudo -u postgres psql -c "ALTER USER user_name WITH ENCRYPTED PASSWORD 'postgres';"
```

On older Ubuntu distributions: Please make sure to have the correct versions of node, PostgreSQL and java installed.

### Docker
This is the fastest way to try webKnossos. Docker CE 17+ and Docker Compose 1.18+ is required. This is only recommended for testing. For production a more elaborate setup with persistent file mounts is recommended.

```
docker-compose up webknossos
```


### Manual Installation

##### Java
* Install Java JDK 8 (from Oracle or OpenJDK)
* make sure `JAVA_HOME` and `JDK_HOME` are set and `PATH` contains path to JDK

##### sbt
See: http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html

##### PostgreSQL
* Install PostgreSQL from https://www.postgresql.org/download/
* PostgreSQL version **10+ is required**

##### node.js & yarn
* Install node from http://nodejs.org/download/
* node version **9+ is required**
* Install yarn package manager: `npm install -g yarn`

### Run locally
```bash
sbt run
```
Will fetch all Scala, Java and node dependencies and run the application on Port 9000. Make sure that the mongoDB service is running before you start sbt.

### Run on a remote machine
```bash
sbt "run -Dhttp.uri=http://<remote address>:9000"
```
Will fetch all Scala, Java and node dependencies and run the application on Port 9000. Make sure that the mongoDB service is running before you start sbt.

Make sure to open port `9000` in our firewall. This is only recommended for development purposes. See below for a recommended production setup.

## Production setup
[See wiki](https://github.com/scalableminds/webknossos/wiki/Production-setup) for recommended production setup.

## Test
```bash
sbt test
yarn test
```

These tests are run on our CI server. Running the tests manually is not encouraged at this point.

## Credits
* scalable minds - https://scm.io/
* Max Planck Institute for Brain Research – https://brain.mpg.de/

# License
AGPLv3
Copyright scalable minds 2018
