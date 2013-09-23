# Awesome Installer
If you are using OSX try using this awesome installer:
https://gist.github.com/3942354

If you are not blessed with a good OS try the steps below and fail ;)


## Project setup:
- install java 1.7 (from oracle! don't use openJDK)
- make sure "JAVA_HOME" and "JDK_HOME" are set and PATH contains path to jdk
- install nodejs + coffee + less and make sure PATH is set to find them 

## Play setup:
You do not need to install / build play on your own computer any more. Play is getting shipped as a dependency via sbt.

## Mongodb
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
