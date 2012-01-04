#Project setup:
- install java 1.6 (from oracle! don't use openJDK)
- make sure "JAVA_HOME" and "JDK_HOME" are set and PATH contains path to jdk

#Play setup:
```bash
git submodule init
git submodule update
cd playframework/framework
./build build-repository
```
-> done!

To run play type 

```bash
playframework/play run
```

in the project root directory.

#Mongodb
- install Mongodb (get the production release from mongodb.org). Unpack:

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
start mongo: mongod --dbpath (your path)
```
