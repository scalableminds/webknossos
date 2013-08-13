#!/bin/bash

if [ $# -lt 1 ]; then
  echo "Usage: $0 <ssh-username on levelcreator.org>"
  exit 1
fi

USER=$1
SERVER="levelcreator.org"
CONTROL_PATH="/tmp/%r@%h:%p"
BINARY_DATA_DIR="/home/deployboy/binaryData"
LOCAL_BINARY_DATA_DIR="../../binaryData"

echo "Select a dataset to download"
echo "cancel with CTRL+C"

function download_segmentation_oriented() {
  echo "Which layer do you want to download?(including color data)"
  select Layer in `ssh $USER@$SERVER -S $CONTROL_PATH ls $BINARY_DATA_DIR/$DataSet/segmentation | grep -P "^layer"`;
  do
    ssh $USER@$SERVER find $BINARY_DATA_DIR/$DataSet/segmentation/$Layer -name "*.raw" -printf '+_%f\\n' > layerfiles
    rsync -rtvuczm --progress --filter=._layerfiles --filter=+_*.json --filter=-_*.raw "$USER@$SERVER:$BINARY_DATA_DIR/$DataSet" $LOCAL_BINARY_DATA_DIR
    rm layerfiles
    break
  done
}

function download_block_range() {
  X_MIN=`ssh $USER@$SERVER -S $CONTROL_PATH ls $BINARY_DATA_DIR/$DataSet/color/1/ | grep -P "x[0-9]{4}" | cut -c2- | head -n 1` #| sed 's/0*//' | sed 's/^$/0/'`
  X_MAX=`ssh $USER@$SERVER -S $CONTROL_PATH ls $BINARY_DATA_DIR/$DataSet/color/1/ | grep -P "x[0-9]{4}" | cut -c2- | tail -n 1` #| sed 's/0*//' | sed 's/^$/0/'`
  echo "Dataset consists of x$X_MIN - x$X_MAX"
  echo "Lower bound for x?"
  read X_LOWER_B
  if [ $X_LOWER_B -lt $X_MIN -o $X_LOWER_B -gt $X_MAX ]; then
    echo "Bad lower bound..."
    exit 1
  fi
  echo "Upper bound for x?"
  read X_UPPER_B
  if [ $X_UPPER_B -lt $X_LOWER_B -o $X_UPPER_B -gt $X_MAX ]; then
    echo "Bad upper bound..."
    exit 1
  fi

  Y_MIN=`ssh $USER@$SERVER -S $CONTROL_PATH ls $BINARY_DATA_DIR/$DataSet/color/1/x$X_MIN/ | grep -P "y[0-9]{4}" | cut -c2- | head -n 1`
  Y_MAX=`ssh $USER@$SERVER -S $CONTROL_PATH ls $BINARY_DATA_DIR/$DataSet/color/1/x$X_MIN/ | grep -P "y[0-9]{4}" | cut -c2- | tail -n 1`
  echo "Dataset consists of y$Y_MIN - y$Y_MAX"
  echo "Lower bound for y?"
  read Y_LOWER_B
  if [ $Y_LOWER_B -lt $Y_MIN -o $Y_LOWER_B -gt $Y_MAX ]; then
    echo "Bad lower bound..."
    exit 1
  fi
  echo "Upper bound for y?"
  read Y_UPPER_B
  if [ $Y_UPPER_B -lt $Y_LOWER_B -o $Y_UPPER_B -gt $Y_MAX ]; then
    echo "Bad upper bound..."
    exit 1
  fi

  Z_MIN=`ssh $USER@$SERVER -S $CONTROL_PATH ls $BINARY_DATA_DIR/$DataSet/color/1/x$X_MIN/y$Y_MIN/ | grep -P "z[0-9]{4}" | cut -c2- | head -n 1`
  Z_MAX=`ssh $USER@$SERVER -S $CONTROL_PATH ls $BINARY_DATA_DIR/$DataSet/color/1/x$X_MIN/y$Y_MIN/ | grep -P "z[0-9]{4}" | cut -c2- | tail -n 1`
  echo "Dataset consists of z$Z_MIN - z$Z_MAX"
  echo "Lower bound for z?"
  read Z_LOWER_B
  if [ $Z_LOWER_B -lt $Z_MIN -o $Z_LOWER_B -gt $Z_MAX ]; then
    echo "Bad lower bound..."
    exit 1
  fi
  echo "Upper bound for z?"
  read Z_UPPER_B
  if [ $Z_UPPER_B -lt $Z_LOWER_B -o $Z_UPPER_B -gt $Z_MAX ]; then
    echo "Bad upper bound..."
    exit 1
  fi
  if [ -f tempfilter ]; then
    rm tempfilter
  fi
  for x in `seq $X_LOWER_B $X_UPPER_B`; do
    for y in `seq $Y_LOWER_B $Y_UPPER_B`; do
      for z in `seq $Z_LOWER_B $Z_UPPER_B`; do
        printf "+_%s_mag1_x%04d_y%04d_z%04d.raw\n" $DataSet $x $y $z >> tempfilter
      done
    done
  done
  rsync -rtvuczm --progress --filter=-_segmentation/ --filter=._tempfilter --filter=+_*.json --filter=-_*.raw  "$USER@$SERVER:$BINARY_DATA_DIR/$DataSet" $LOCAL_BINARY_DATA_DIR
  rm tempfilter
}
echo "setting up ssh connection"
ssh $USER@$SERVER -fN -M -S $CONTROL_PATH
PS3="Your choice: "
select DataSet in `ssh $USER@$SERVER ls $BINARY_DATA_DIR`;
do
    echo "You picked $DataSet ($REPLY)"
    echo "Download full or partial dataset?"
    select Choice in `echo full; echo partial`;
    do
      case $Choice in
        "full")
          rsync -rtvucz --progress "$USER@$SERVER:$BINARY_DATA_DIR/$DataSet" $LOCAL_BINARY_DATA_DIR
          ;;
        "partial")
          RANGE=4
          RESOLUTION=1
          ssh $USER@$SERVER -S $CONTROL_PATH test -d $BINARY_DATA_DIR/$DataSet/segmentation

          if [[ $? -eq 0 ]]; then
            echo "For $DataSet segmentation is available, do you want to download segmentation block oriented or do you want to give ranges for blocks?"
            select Choice in `echo "segmentation-oriented"; echo "range-oriented"`;
            do
              case $Choice in 
                "segmentation-oriented")
                  download_segmentation_oriented
                  ;;
                "range-oriented")
                  download_block_range
                  ;;
              esac
              break
            done
          else
            download_block_range
          fi
          ;;
      esac
      break
    done
    break
done