![Oxalis logo](https://oxalis.at/assets/images/oxalis.svg)
# webKnossos
webKnossos is a web-based annotation tool for large 3d image datasets.

# Dependencies

* [Java JDK 1.7 (Oracle version)](http://www.oracle.com/technetwork/java/javase/downloads/index.html)
* [sbt](http://www.scala-sbt.org/)
* [mongoDB 2.4.3+](http://www.mongodb.org/downloads)
* [node.js 0.10.0+](http://nodejs.org/download/)
* [git](http://git-scm.com/downloads)

# Installation
## OS X
If you are using OS X try using this awesome installer:
https://gist.github.com/normanrz/9128496

Or install Java manually and run:

```bash
# Install Homebrew package manager
ruby -e "$(curl -fsSL https://raw.github.com/Homebrew/homebrew/go/install)"

# Install git, node.js, mongoDB, sbt
brew install git node mongodb sbt

# Start mongo
launchctl load ~/Library/LaunchAgents/homebrew.mxcl.mongodb.plist

# Checkout the Oxalis git repository
git clone git@github.com:scalableminds/oxalis.git
```


## Manual Installation

### Java
- install Java JDK 1.7 (from Oracle, OpenJDK is currently not supported)
- make sure `JAVA_HOME` and `JDK_HOME` are set and `PATH` contains path to JDK

### sbt
See: http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html

### mongoDB
- install mongoDB from http://www.mongodb.org/downloads
- mongoDB version **2.4.3+ is required**
- your package managers' versions (e.g. `apt-get`) might be outdated

- unpack

```bash
tar -xvf mongo(...).tgz
sudo mv mongo(...) /usr/local/mongodb
```

- set environment, append /usr/local/mongodb/bin to path

```bash
sudo vim /etc/environment
```

- logout and login again to reload environment.
- set up database dir (create (your path)/data/db where you want to save your database)

```bash	
mongod --dbpath (your path)
```

### node.js
* install node from http://nodejs.org/download/
* node version **0.10.0+ is required**
* your package managers' versions (e.g. `apt-get`) might be outdated
* no node modules are required to be installed globally. but installing the following is handy for development
  * [coffee-script](https://github.com/jashkenas/coffeescript)
  * [less](http://lesscss.org/)
  * [bower](http://bower.io/)
  * [gulp](http://gulpjs.com/)
  
```bash
npm install -g coffee-script less bower gulp
```

# Run
```bash
sbt run
```

Will fetch all Scala, Java and node dependencies and run the application on Port 9000.

# Credits
scalable minds - http://scm.io

# License
MIT

Includes GraphViz by John Ellson et al. (http://www.graphviz.org/) under EPL
