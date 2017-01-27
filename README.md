# webKnossos
Cellular-resolution connectomics is currently substantially limited by the throughput and efficiency of data analysis. Current solutions require an efficient integration of automated image analysis with massive manual data annotation. To scale such annotation efforts it is decisive to be able to crowd source data analysis online. Here we present **webKnossos** (former oxalis).

![webKnossos logo](https://webknossos.brain.mpg.de/assets/images/oxalis.svg)

## Dependencies

* [Oracle JDK 8+](http://www.oracle.com/technetwork/java/javase/downloads/index.html) or [Open JDK 8+](http://openjdk.java.net/) (full JDK, JRE is not enough)
* [sbt](http://www.scala-sbt.org/)
* [mongoDB 3+](http://www.mongodb.org/downloads)
* [node.js 7+](http://nodejs.org/download/)
* [yarn package manager](https://yarnpkg.com/)
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
npm install -g yarn

# Start mongo
brew services start mongodb

# Checkout the webKnossos git repository
git clone git@github.com:scalableminds/webknossos.git
```


#### Ubuntu 16.04 LTS

```
# Adding repositories for sbt, nodejs and yarn
echo "deb https://dl.bintray.com/sbt/debian /" | sudo tee -a /etc/apt/sources.list.d/sbt.list
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 642AC823
curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash -
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list

# Installing everything
sudo apt-get update
sudo apt-get install -y git mongodb-server nodejs scala sbt openjdk-8-jdk yarn
```

On older Ubuntu distributions: Please make sure to have the correct versions of node, mongoDB and java installed.

#### Docker
This is the fastest way to try webKnossos. Docker 1.12+ and Docker Compose 1.8+ is required. This is only recommended for testing. For production a more elaborate setup with persistent file mounts is recommended.

```
docker-compose up webknossos
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

##### node.js & yarn
* Install node from http://nodejs.org/download/
* node version **7+ is required**
* Install yarn package manager: `npm install -g yarn`

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
* scalable minds - https://scm.io/
* Max Planck Institute for Brain Research – https://brain.mpg.de/

# License
AGPLv3

