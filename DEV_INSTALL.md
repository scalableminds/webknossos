# Development installation

## Docker

This is only recommended for local testing (not for development). Docker 19.03.0+ and Docker Compose 2.+ are required.

```bash
git clone -b master --depth=1 git@github.com:scalableminds/webknossos.git
cd webknossos
docker compose pull webknossos
./start-docker.sh
```

Open your local WEBKNOSSOS instance on [localhost:9000](http://localhost:9000) and complete the onboarding steps in the browser.
Now, you are ready to use your local WEBKNOSSOS instance.

See the wiki for [instructions on updating](https://github.com/scalableminds/webknossos/wiki/Development-setup) this development setup.

For non-localhost deployments, check out the [installation guide in the documentation](https://docs.webknossos.org/webknossos/installation.html).

## Dependencies

* [Oracle JDK 21](http://www.oracle.com/technetwork/java/javase/downloads/index.html) or [Eclipse Temurin JDK 21](https://adoptium.net/temurin/releases/) (full JDK, JRE is not enough)
* [sbt](http://www.scala-sbt.org/)
* [PostgreSQL 10+](https://www.postgresql.org/)
* [Redis 5+](https://redis.io/)
* [Blosc](https://github.com/Blosc/c-blosc)
* [Brotli](https://github.com/google/brotli)
* [Draco](https://github.com/google/draco)
* [node.js 18](http://nodejs.org/download/)
* [yarn package manager](https://yarnpkg.com/)
* [git](http://git-scm.com/downloads)
* [cmake](https://cmake.org/download/)

* For some development tasks like refreshing snapshots, Docker 19.03.0+ and Docker Compose 2.+ are required

## MacOS

```bash
# WEBKNOSSOS needs to be run from x86_64 environment (only applicable for arm64-based Macs)
arch -x86_64 /bin/zsh

# Install Homebrew package manager
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install git, node.js, postgres, sbt, gfind, gsed, draco
brew install openjdk draco openssl git node postgresql sbt findutils coreutils gnu-sed redis c-blosc brotli wget

# Set env variables for openjdk and openssl
# You probably want to add these lines manually to avoid conflicts in your zshrc
echo 'if [ $(arch) = "i386" ]; then' >> ~/.zshrc
echo '  export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home' >> ~/.zshrc
echo '  export PATH="/usr/local/opt/openjdk/bin:$PATH"' >> ~/.zshrc
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

# Checkout the WEBKNOSSOS git repository
git clone git@github.com:scalableminds/webknossos.git
```

Note: On arm64-based Macs (e.g. M1), you need to run WEBKNOSSOS in an x86_64 environment (Rosetta 2). In case you accidentally started WEBKNOSSOS in an arm64 environment, it is advisable to delete several caches `~/.m2`, `~/ivy2`, `~/.sbt`, `~/.yarn-cache` and run `./clean`. Since Postgres and Redis are isolated processes, they can be run either from arm64 or x86_64 environments.

## Ubuntu 22.04 LTS

```bash
sudo apt install -y curl ca-certificates wget

# Install nvm, node 18
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

sudo apt update
sudo apt install -y git postgresql postgresql-client unzip zip redis-server build-essential libblosc1 libbrotli1 libdraco-dev cmake

 # Install sdkman, java, scala and sbt
curl -s "https://get.sdkman.io" | bash
source "$HOME/.sdkman/bin/sdkman-init.sh"
sdk install scala 2.13.12
sdk install sbt
sdk install java 21.0.2-tem
# Source sdkman-init.sh again to load environment variables like JAVA_HOME
source "$HOME/.sdkman/bin/sdkman-init.sh"

# Assign a password to PostgreSQL user
sudo -u postgres psql -c "ALTER USER postgres WITH ENCRYPTED PASSWORD 'postgres';"
# Clone the git repo to the current directory
git clone git@github.com:scalableminds/webknossos.git
```

On older Ubuntu distributions: Please make sure to have the correct versions of node, PostgreSQL and java installed.

## Manual Installation

### Java

* Install Java JDK 21 (from Oracle or OpenJDK)
* make sure `JAVA_HOME` and `JDK_HOME` are set and `PATH` contains the path to JDK
* Also see [SDKMAN!](https://sdkman.io/) for a convenient way to install and manage Java versions

### sbt

* See: [http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html](http://www.scala-sbt.org/release/docs/Getting-Started/Setup.html)

### PostgreSQL

* Install PostgreSQL from [https://www.postgresql.org/download/](https://www.postgresql.org/download/)
* PostgreSQL version **10+ is required**

### Redis

* Install Redis from [https://redis.io/download](https://redis.io/download)

### node.js & yarn

* Install node from [http://nodejs.org/download/](http://nodejs.org/download/)
* node version **18 is required**
* Use `corepack` to install `yarn`
* `corepack enable`&& `yarn install`


## Run locally

First, install all frontend dependencies via

```bash
yarn install
```

Note: During this installation step, it might happen that the module `gl` cannot be installed correctly. As this module is only used for testing WEBKNOSSOS, you can safely ignore this error.

Note: If you are getting node version incompatibility errors, it is usually safe to call yarn with [`--ignore-engines`](https://classic.yarnpkg.com/lang/en/docs/cli/install/#toc-yarn-install-ignore-engines).

To start WEBKNOSSOS, use

```bash
yarn start
```

This will fetch all Scala, Java and node dependencies and run the application on Port 9000.
Make sure that the PostgreSQL and Redis services are running before you start the application.

## Upgrades

When pulling newer versions, please check the changelog ([released](CHANGELOG.released.md) and [unreleased](CHANGELOG.unreleased.md)) and migration guide ([released](MIGRATIONS.released.md) and [unreleased](MIGRATIONS.unreleased.md)).

Note: If the postgres schema changed, you may see compilation errors in the form of `value * is not a member of com.scalableminds.webknossos.schema.Tables.*` – run the SQL migrations from the migration guide or reset your database with `yarn refresh-schema` and restart the server to fix those.

## Tests and Tools

```bash
# Frontend linting
yarn run lint

# Format frontend code
yarn format-frontend

# Format backend code
yarn format-backend

# Frontend type checking
yarn tsc

# Frontend tests
yarn test-verbose

# End-to-end tests
docker compose run e2e-tests
```

For more commands, see the `scripts` section in [package.json](package.json).
