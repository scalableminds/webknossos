#!/bin/bash

if [ $# -lt 1 ]; then
  echo "Usage: $0 <username on levelcreator.org>"
  exit 1
fi

USER=$1
SERVER="levelcreator.org"
BINARY_DATA_DIR="/home/deployboy/binaryData"

echo "Select a dataset to download"
echo "cancel with CTRL+C"

PS3="Your choice: "
select DataSet in `ssh $USER@$SERVER ls $BINARY_DATA_DIR`;
do
    echo "You picked $DataSet ($REPLY)"
    echo "Download full or partial dataset?"
    select Choice in `echo full; echo partial`;
    do
      case $Choice in
        "full")
          rsync -rtvucz --progress "$USER@$SERVER:$BINARY_DATA_DIR/$DataSet" .
          ;;
        "partial")
          RANGE=4
          RESOLUTION=1
          ssh $USER@$SERVER test -d $BINARY_DATA_DIR/$DataSet/segmentation
          if [[ $? -eq 0 ]]; then
            echo "For $DataSet segmentation is available, which layer do you want to download?(including corresponding color data)"
            select Layer in `ssh $USER@$SERVER ls $BINARY_DATA_DIR/$DataSet/segmentation | grep -P "^layer"`;
            do
              ssh $USER@$SERVER find $BINARY_DATA_DIR/$DataSet/segmentation/$Layer -name "*.raw" -printf "+_%f\n" > layerfiles
              rsync -rtvuczm --progress --filter=._layerfiles --filter=+_*.json --filter=-_*.raw "$USER@$SERVER:$BINARY_DATA_DIR/$DataSet" .
              break

            done
          fi

          X_MIN=`ssh $USER@$SERVER ls $BINARY_DATA_DIR/$DataSet/color/1/ | grep -P "x[0-9]{4}" | cut -c2- | head -n 1` #| sed 's/0*//' | sed 's/^$/0/'`
          X_MAX=`ssh $USER@$SERVER ls $BINARY_DATA_DIR/$DataSet/color/1/ | grep -P "x[0-9]{4}" | cut -c2- | tail -n 1` #| sed 's/0*//' | sed 's/^$/0/'`
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

          Y_MIN=`ssh $USER@$SERVER ls $BINARY_DATA_DIR/$DataSet/color/1/x$X_MIN/ | grep -P "y[0-9]{4}" | cut -c2- | head -n 1`
          Y_MAX=`ssh $USER@$SERVER ls $BINARY_DATA_DIR/$DataSet/color/1/x$X_MIN/ | grep -P "y[0-9]{4}" | cut -c2- | tail -n 1`
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

          Z_MIN=`ssh $USER@$SERVER ls $BINARY_DATA_DIR/$DataSet/color/1/x$X_MIN/y$Y_MIN/ | grep -P "z[0-9]{4}" | cut -c2- | head -n 1`
          Z_MAX=`ssh $USER@$SERVER ls $BINARY_DATA_DIR/$DataSet/color/1/x$X_MIN/y$Y_MIN/ | grep -P "z[0-9]{4}" | cut -c2- | tail -n 1`
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
          for x in `seq $X_LOWER_B $X_UPPER_B`; do
            for y in `seq $Y_LOWER_B $Y_UPPER_B`; do
              for z in `seq $Z_LOWER_B $Z_UPPER_B`; do
                printf "%s_mag1_x%04d_y%04d_z%04d.raw\n" $DataSet $x $y $z >> tempfilter
              done
            done
          done
          #rsync -rtvuczm --progress --filter=+_*.json --filter=-_*.raw "$USER@$SERVER:$BINARY_DATA_DIR/$DataSet" .
          ;;
      esac
      break
    done
    break
done