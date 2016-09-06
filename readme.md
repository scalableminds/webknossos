# webKnossos
Cellular-resolution connectomics is currently substantially limited by the throughput and efficiency of data analysis. Current solutions require an efficient integration of automated image analysis with massive manual data annotation. To scale such annotation efforts it is decisive to be able to crowd source data analysis online. Here we present **webKnossos** (former oxalis),

![webKnossos logo](https://webknossos.brain.mpg.de/assets/images/oxalis.svg)

## Dependencies

* [Oracle JDK 8+](http://www.oracle.com/technetwork/java/javase/downloads/index.html) or [Open JDK 8+](http://openjdk.java.net/) (full JDK, JRE is not enough)
* [sbt](http://www.scala-sbt.org/)
* [mongoDB 3+](http://www.mongodb.org/downloads)
* [node.js 4+](http://nodejs.org/download/)
* [git](http://git-scm.com/downloads)

## Installation
If you are installing *webKnossos* in a virtual machine, please make sure you allocated **enough memory**. A good value is 5 GB.

#### OS X
If you are using OS X try using this awesome installer:
https://gist.github.com/normanrz/9128496

Or install Java manually and run:

```bash
# Install Homebrew package manager
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

# Install git, node.js, mongoDB, sbt
brew install git node mongodb sbt

# Start mongo
brew services start mongodb

# Checkout the webKnossos git repository
git clone git@github.com:scalableminds/oxalis.git
```


#### Ubuntu 16.04 LTS

```
# Adding repository for sbt
echo "deb https://dl.bintray.com/sbt/debian /" | sudo tee -a /etc/apt/sources.list.d/sbt.list
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 642AC823

# Installing everything
sudo apt-get update
sudo apt-get install -y git mongodb-server nodejs nodejs-legacy scala npm sbt openjdk-8-jdk
```

On older Ubuntu distributions: Please make sure to have the correct versions of node, mongoDB and java installed.

#### Docker
This is the fastest way to try webKnossos. Docker 1.12+ and Docker Compose 1.8+ is required. This is only recommended for testing. For production a more elaborate setup with persistent file mounts is recommended.

```
DOCKER_TAG=branch-master docker-compose up oxalis
```


#### Manual Installation

##### Java
* Install Java JDK 8 (from Oracle or OpenJDK)
* make sure `JAVA_HOME` and `JDK_HOME` are set and `PATH` contains path to JDK

##### sbt
See: http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html

##### mongoDB
* Install mongoDB from http://www.mongodb.org/downloads
* mongoDB version **3+ is required**

##### node.js
* Install node from http://nodejs.org/download/
* node version **4+ is required**

### Run
```bash
sbt run
```

Will fetch all Scala, Java and node dependencies and run the application on Port 9000. Make sure that the mongoDB service is running before you start sbt.

## Test
```bash
sbt test
npm test
```

These tests are run on our CI server. Running the tests manually in not encouraged at this point.

## Credits
scalable minds - http://scm.io

# License
MIT

