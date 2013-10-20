#!/bin/sh

ZSTOR_SERVER="newton"
SCM_SERVER="levelcreator.org"
ZSTOR_BINARY_DATA_DIR="/zdata/thomas/binaryData"
SCM_BINARY_DATA_DIR="/home/deployboy/binaryData"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <directoryToSync>"
  exit 1
fi

function syncToRemote
{
  dataset_path=$1
  remote=$2
  #TODO: add --delete
  rsync -rtucz --progress $dataset_path"/segmentation/" $remote/segmentation 
  rsync -tuc $dataset_path"/settings.json" $remote
}

read -p "Do you really want to distribute the segmentation data in $1? [y/N]" -n 1 -r
if [[ $REPLY == "y" ]]
then
  for dataset in `find $1 -follow -mindepth 2 -maxdepth 2 -type d -name segmentation | cut -d/ -f2`
  do 
     syncToRemote $1/$dataset "$ZSTOR_SERVER:$ZSTOR_BINARY_DATA_DIR/$dataset"
     syncToRemote $1/$dataset "$SCM_SERVER:$SCM_BINARY_DATA_DIR/$dataset"
  done
fi
