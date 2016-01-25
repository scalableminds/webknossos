#!/bin/bash

sbt clean compile stage
docker build -t scalableminds/oxalis:latest .
