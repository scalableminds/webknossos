#!/bin/sh

ZSTOR_SERVER="newton"
SCM_SERVER="78.47.16.186"
ZSTOR_BINARY_DATA_DIR="/zdata/thomas/binaryData"
SCM_BINARY_DATA_DIR="/srv/binaryData"

if [ $# -lt 3 ]; then
  echo "Usage: $0 <directoryToSync> <user on levelcreator.org> <user on newton>"
  exit 1
fi

SYNCDIR="$1"
USER_LEVELCREATOR="$2"
USER_NEWTON="$3"

function syncToRemote
{
  dataset_path=$1
  remote=$2
  rsync -rtucz --progress $dataset_path"/segmentation/" $remote/segmentation 
  rsync -tuc $dataset_path"/settings.json" $remote
}

read -p "Do you really want to distribute the segmentation data in ${SYNCDIR}? [y/N]" -n 1 -r
if [[ $REPLY == "y" ]]
then
  for dataset in `find ${SYNCDIR} -follow -mindepth 2 -maxdepth 2 -type d -name segmentation | cut -d/ -f2`
  do 
     syncToRemote ${SYNCDIR}/${dataset} "${USER_NEWTON}@${ZSTOR_SERVER}:${ZSTOR_BINARY_DATA_DIR}/${dataset}"
     syncToRemote ${SYNCDIR}/${dataset} "${USER_LEVELCREATOR}@${SCM_SERVER}:${SCM_BINARY_DATA_DIR}/${dataset}"
  done
fi
