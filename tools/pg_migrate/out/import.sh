#!/bin/bash
psql -c "COPY $(basename $1 .csv) FROM STDOUT WITH CSV HEADER QUOTE ''''" < $1
