## Development installation
### Docker
This is only recommended for local testing. Docker 17+ and Docker Compose 1.18+ are required.

```bash
git clone -b master --depth=1 git@github.com:scalableminds/webknossos.git
cd webknossos
docker-compose pull webknossos
./start-docker.sh
```

Open your local webKnossos instance on [localhost:9000](http://localhost:9000) and complete the onboarding steps in the browser.
Now, you are ready to use your local webKnossos instance.

See the wiki for [instructions on updating](https://github.com/scalableminds/webknossos/wiki/Development-setup) this development setup.

For non-localhost deployments, check out the [installation guide in the documentation](https://docs.webknossos.org/webknossos/installation.html).

### Dependencies

* [Oracle JDK 8 to 14](http://www.oracle.com/technetwork/java/javase/downloads/index.html) or [Open JDK 8 to 14](http://openjdk.java.net/) (full JDK, JRE is not enough)
* [sbt](http://www.scala-sbt.org/)
* [PostgreSQL 10+](https://www.postgresql.org/)
* [Redis 5+](https://redis.io/)
* [Blosc](https://github.com/Blosc/c-blosc)
* [node.js 16 or 18](http://nodejs.org/download/)
* [yarn package manager](https://yarnpkg.com/)
* [git](http://git-scm.com/downloads)

### MacOS
```bash
# webKnossos needs to be run from x86_64 environment (only applicable for arm64-based Macs)
arch -x86_64 /bin/zsh

# Install Homebrew package manager
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install git, node.js, postgres, sbt, gfind, gsed
brew install openjdk@14 openssl git node postgresql sbt findutils coreutils gnu-sed redis yarn

# Set env variables for openjdk and openssl
# You probably want to add these lines manually to avoid conflicts in your zshrc
echo 'if [ $(arch) = "i386" ]; then' >> ~/.zshrc
echo '  export PATH="/usr/local/opt/openjdk@14/bin:$PATH"' >> ~/.zshrc
echo '  export PATH="/usr/local/opt/openssl/bin:$PATH"' >> ~/.zshrc
echo '  export LDFLAGS="-L/usr/local/opt/openssl/lib"' >> ~/.zshrc
echo '  export CPPFLAGS="-I/usr/local/opt/openssl/include"' >> ~/.zshrc
echo 'fi' >> ~/.zshrc

# Start postgres and redis
brew services start postgresql
brew services start redis

# Create PostgreSQL user
createdb
psql -c "CREATE DATABASE webknossos;"
psql -c "CREATE USER postgres WITH ENCRYPTED PASSWORD 'postgres';"
psql -c "ALTER USER postgres WITH SUPERUSER;"
psql -c "GRANT ALL PRIVILEGES ON DATABASE webknossos TO postgres;"

# Checkout the webKnossos git repository
git clone git@github.com:scalableminds/webknossos.git


```

Note: On arm64-based Macs (e.g. M1), you need to run webKnossos in an x86_64 environment (Rosetta 2). In case you accidentally started webKnossos in an arm64 environment, it is advisable to delete several caches `~/.m2`, `~/ivy2`, `~/.sbt`, `~/.yarn-cache` and run `./clean`. Since Postgres and Redis are isolated processes, they can be run either from arm64 or x86_64 environments.


### Ubuntu 20.04 LTS

```bash
sudo apt install -y curl ca-certificates wget
# Adding repositories for nodejs, sbt and yarn
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
echo "deb https://repo.scala-sbt.org/scalasbt/debian all main" | sudo tee /etc/apt/sources.list.d/sbt.list
echo "deb https://repo.scala-sbt.org/scalasbt/debian /" | sudo tee /etc/apt/sources.list.d/sbt_old.list
curl -sL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x2EE0EA64E40A89B84B2DF73499E82A75642AC823" | sudo apt-key add
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list

sudo apt update
sudo apt install -y nodejs git postgresql postgresql-client scala sbt openjdk-14-jdk yarn redis-server build-essential libblosc1

# Assign a password to PostgreSQL user
sudo -u postgres psql -c "ALTER USER postgres WITH ENCRYPTED PASSWORD 'postgres';"
# Clone the git repo to the current directory
git clone -b master --depth=1 https://github.com/scalableminds/webknossos.git
```

If you already have a different Java version installed, set the default version to Java 14:
- run `sudo update-alternatives --config java`
- when prompted, select the desired version

On older Ubuntu distributions: Please make sure to have the correct versions of node, PostgreSQL and java installed.

### Manual Installation

##### Java
* Install Java JDK 14 (from Oracle or OpenJDK)
* make sure `JAVA_HOME` and `JDK_HOME` are set and `PATH` contains the path to JDK

##### sbt
See: http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html

##### PostgreSQL
* Install PostgreSQL from https://www.postgresql.org/download/
* PostgreSQL version **10+ is required**

##### Redis
* Install Redis from https://redis.io/download

##### node.js & yarn
* Install node from http://nodejs.org/download/
* node version **16+ is required**
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

# Format backend code
yarn pretty-backend

# Frontend type checking
yarn flow

# Frontend tests
yarn test-verbose

# End-to-end tests
docker-compose run e2e-tests
```
