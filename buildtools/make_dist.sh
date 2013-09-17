#!/bin/sh

if [ $# -lt 4 ]; then
  echo "Usage: <project> <branch> <pkgType(deb|rpm)> <iteration>"
  exit 1
fi

PROJECT=${1}
BRANCH=${2}
PKG_TYPE=${3}
ITERATION=${4}
NAME="${PROJECT}-${BRANCH}"

#change to play root
pushd `dirname $0`/..

#1 modulename (oxalis/levelcreator/stackrenderer)

sbt "project $PROJECT" dist || (echo "error creating packages: (maybe bad project name)"; exit 1)

DIST_DIR=""
if [ $PROJECT = oxalis ]; then
  DIST_DIR=dist/
else
  DIST_DIR=modules/$PROJECT/dist
fi
pushd $DIST_DIR

ZIP=`ls $PROJECT*.zip | sort | tail -n 1`
unzip -uq ${ZIP}
rm ${ZIP}

APP=${ZIP%.zip}
VERSION=${APP##*-}

cd $APP
JAR=`ls lib/$PROJECT_*-$VERSION.jar | sort | tail -n 1`

CLASSPATH_REF="\$scriptdir/${JAR}"
#delete ref
sed -i "s#:$CLASSPATH_REF##g" start
#add ref to the beginning
sed -i "s#^classpath=\"#classpath=\"$CLASSPATH_REF:#g" start

chmod +x start

cd ..
if [ -d rootenv ]; then
  rm -rf rootenv
fi

INSTALL_DIR=rootenv/usr/lib/$NAME
mkdir -p $INSTALL_DIR
cp $APP/start $INSTALL_DIR/start
cp -r $APP/lib $INSTALL_DIR/

#go back to play root again
popd

INIT_SYSTEM=""
FPM=""
case $PKG_TYPE in
  "deb")
    FPM="fpm"
  ;;
  "rpm")
    FPM="fpm1.9"
  ;;
  "*")
    echo "Only deb and rpm are supported, yet"
    exit 1
esac

$FPM -m thomas@scm.io -s dir -t $PKG_TYPE -n "${PROJECT}-${BRANCH}" -v $VERSION --iteration $ITERATION --after-install="buildtools/application-after-install.sh" --template-scripts --template-value application="${PROJECT}-${BRANCH}" -C $DIST_DIR/rootenv usr/

popd