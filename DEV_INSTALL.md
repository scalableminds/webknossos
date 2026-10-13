# Development installation


## Dependencies

* [PostgreSQL 12+](https://www.postgresql.org/)
* [Redis 5+](https://redis.io/)
* [Brotli](https://github.com/google/brotli)
* [Draco](https://github.com/google/draco)
* [node.js 22+](https://nodejs.org/)
* [yarn package manager](https://yarnpkg.com/)
* [git](https://git-scm.com/downloads)
* [cmake](https://cmake.org/download/)

* For some development tasks like refreshing snapshots, Docker 19.03.0+ and Docker Compose 2.+ are required

The backend is built with [Mill](https://mill-build.org/). Neither Mill nor a JDK need to be installed: the `./mill` script in the repository downloads both (Mill's version and the JDK version are configured at the top of `build.mill`).

## MacOS

```bash

# Install Homebrew package manager
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install git, node.js, postgres, gfind, gsed, draco
brew install draco openssl git node postgresql findutils coreutils gnu-sed redis brotli wget cmake

# Set env variables for openssl
# You probably want to add these lines manually to avoid conflicts in your zshrc
echo 'export PATH="/opt/homebrew/opt/openssl/bin:$PATH"' >> ~/.zshrc
echo 'export LDFLAGS="-L/opt/homebrew/opt/openssl/lib"' >> ~/.zshrc
echo 'export CPPFLAGS="-I/opt/homebrew/opt/openssl/include"' >> ~/.zshrc

# Start postgres and redis
brew services start postgresql
brew services start redis

# Create PostgreSQL user
createdb
psql -c "CREATE DATABASE webknossos;"
psql -c "CREATE USER postgres WITH ENCRYPTED PASSWORD 'postgres';"
psql -c "ALTER USER postgres WITH SUPERUSER;"
psql -c "GRANT ALL PRIVILEGES ON DATABASE webknossos TO postgres;"

# Enable corepack for nodeJs and yarn
npm install -g corepack 
corepack enable

# Checkout the WEBKNOSSOS git repository
git clone git@github.com:scalableminds/webknossos.git
```

Note: On arm64-based Macs (e.g. M1), you need to run WEBKNOSSOS in an x86_64 environment (Rosetta 2). In case you accidentally started WEBKNOSSOS in an arm64 environment, it is advisable to delete several caches `~/.m2`, `~/.cache/mill`, `~/.yarn-cache` and run `./clean`. Since Postgres and Redis are isolated processes, they can be run either from arm64 or x86_64 environments.

## Ubuntu 22.04 LTS

```bash
sudo apt update
sudo apt install -y curl ca-certificates wget git postgresql postgresql-client unzip zip redis-server build-essential libbrotli1 libdraco-dev cmake

# Install nvm, node 22
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# Assign a password to PostgreSQL user
sudo -u postgres psql -c "ALTER USER postgres WITH ENCRYPTED PASSWORD 'postgres';"

# Clone the git repo to the current directory
git clone git@github.com:scalableminds/webknossos.git
cd webknossos

# Enable node corepack to select the right yarn, install node packages
corepack enable
yarn install
```

On older Ubuntu distributions: Please make sure to have the correct versions of node and PostgreSQL installed.

## Manual Installation

### PostgreSQL

* Install PostgreSQL from [https://www.postgresql.org/download/](https://www.postgresql.org/download/)
* PostgreSQL version **12+ is required**

### Redis

* Install Redis from [https://redis.io/download](https://redis.io/download)

### node.js & yarn

* Install node from [https://nodejs.org/](https://nodejs.org/)
* node version **22+ is required**
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

The backend runs in Play dev mode on port 9001 (`yarn start-backend`) and restarts when its code changes. A debugger can be attached on port 5005 (set `WK_DEBUG_PORT` to change it).

For IntelliJ IDEA, run `./mill --bsp-install` once and open the repository as a BSP project. Metals (VS Code) detects Mill builds by itself.

## Upgrades

When pulling newer versions, please check the changelog ([released](CHANGELOG.released.md) and [unreleased](CHANGELOG.unreleased.md)) and migration guide ([released](MIGRATIONS.released.md) and [unreleased](MIGRATIONS.unreleased.md)).

Note: If the postgres schema changed, you may see compilation errors in the form of `value * is not a member of com.scalableminds.webknossos.schema.Tables.*` – run the SQL migrations from the migration guide or reset your database with `yarn refresh-schema` and restart the server to fix those.

## Tests and Tools

```bash
# Frontend linting & Formatting
yarn fix-frontend

# Backend formatting & linting
yarn fix-backend

# Backend type checking (compiles webknossos and the modules it depends on)
./mill compile

# Backend unit tests
yarn test-backend

# Frontend type checking
yarn typecheck

# Frontend tests
yarn test

# End-to-end tests
docker compose run e2e-tests
```

For more commands, see the `scripts` section in [package.json](package.json).

## Passkeys

Passkeys are only supported with HTTPS. You can generate self-signed certificates for local development with `./tools/gen-ssl-dev-certs.sh`. 

You must also update `conf/application.conf`:
- Set `http.uri` to `https://localhost:<port>`
- Set `features.passkeysEnabled` to `true`

You must also update your `vite.config.ts`: Comment in the `server.https` related lines.
