#!/bin/sh


if [ $# -lt 1 ]; then
echo "Usage: $0 <iteration> "
  exit 1
fi

ITERATION=${1}
PROJECT="oxalis"
BRANCH=`git rev-parse --abbrev-ref HEAD`
NAME=${PROJECT}-${BRANCH}
#change to play root
cd `dirname $0`/..

DIST_DIR=dist
if [ -d $DIST_DIR ]; then
  rm -rf $DIST_DIR
fi

sbt clean compile dist || (echo "error creating package, aborting ..."; exit 1)

cd $DIST_DIR

ZIP=`ls $PROJECT*.zip | sort | tail -n 1`
unzip -uq ${ZIP}

APP=${ZIP%.zip}
VERSION=${APP##*-}

cd $APP
JAR=`ls lib/${PROJECT}_*-$VERSION.jar | sort | tail -n 1`

sed -i "s#^scriptdir=.*#installdir=/usr/lib/${NAME}#" start
sed -i "s#\$scriptdir#\$installdir#g" start

chmod +x start

cd ..

mkdir -p rootenv/usr/lib/${NAME}
cp $APP/start rootenv/usr/lib/${NAME}/start
cp -r $APP/lib rootenv/usr/lib/${NAME}
mkdir -p rootenv/usr/bin
ln -sf /usr/lib/${NAME}/start rootenv/usr/bin/${NAME}

#go back to play root again
cd ..

for PKG_TYPE in "deb" "rpm"
do
  fpm -m thomas@scm.io -s dir -t $PKG_TYPE -n ${NAME} -v $VERSION --iteration $ITERATION -C $DIST_DIR/rootenv usr/
done