#!/bin/bash
bower install
rm -rf .tmp
rm -rf public/javascripts/min
mkdir .tmp
cp -R public/bower_components .tmp/bower_components
cp -R public/javascripts .tmp/javascripts
coffee -co .tmp/javascripts app/assets/javascripts
r.js -o build.js