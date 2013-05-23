#!/bin/sh

if [ $# -lt 3 ]; then
  echo "Usage: <project> <pkgType(deb|rpm)> <iteration>"
  exit 1
fi

PROJECT=${1-"oxalis"}
PKG_TYPE=${2-"deb"}
ITERATION=${3}

#change to play root
pushd `dirname $0`/..

#1 modulename (oxalis/levelcreator/stackrenderer)

./playframework/play "project $PROJECT" dist || (echo "error creating packages: (maybe bad project name)"; exit 1)

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

sed -e "s#^scriptdir=.*#installdir=/usr/lib/$PROJECT#g" start > start.dist
sed -i "s#\$scriptdir#\$installdir#g" start.dist

CONFIG="-Dconfig.resource=production.conf"

if [ "$PROJECT" = "stackrenderer" -a "$PKG_TYPE" = "rpm" ]; then
  CONFIG="$CONFIG -Djava.io.tmpdir=/disk"
fi

EXECUTION_COMMAND="exec java $CONFIG \$* -cp \$classpath play.core.server.NettyServer /etc/$PROJECT &"

sed -i "/^exec/ c\
$EXECUTION_COMMAND" start.dist

chmod +x start.dist
chmod +x start

cd ..
if [ -d rootenv ]; then
  rm -rf rootenv
fi

mkdir -p rootenv/usr/lib/$PROJECT
cp $APP/start.dist rootenv/usr/lib/$PROJECT/start
cp -r $APP/lib rootenv/usr/lib/$PROJECT
mkdir -p rootenv/usr/bin
ln -sf /usr/lib/$PROJECT/start rootenv/usr/bin/$PROJECT

#go back to play root again
popd

INIT_SYSTEM=""
FPM=""
case $PKG_TYPE in
  "deb")
  FPM="fpm"
    INIT_SYSTEM="sysvinit"
    mkdir -p $DIST_DIR/rootenv/etc/init.d/
    cp buildtools/${INIT_SYSTEM}_template $DIST_DIR/rootenv/etc/init.d/$PROJECT
    chmod +x $DIST_DIR/rootenv/etc/init.d/$PROJECT
    sed -i "s/<%PROJECT%>/$PROJECT/g" $DIST_DIR/rootenv/etc/init.d/$PROJECT

  ;;
  "rpm")
    FPM="fpm1.9"
    INIT_SYSTEM="systemd"
    mkdir -p $DIST_DIR/rootenv/etc/systemd/system
    cp buildtools/${INIT_SYSTEM}_template $DIST_DIR/rootenv/etc/systemd/system/$PROJECT.service
    sed -i "s/<%PROJECT%>/$PROJECT/g" $DIST_DIR/rootenv/etc/systemd/system/$PROJECT.service
  ;;
  "*")
    echo "Only deb and rpm are supported, yet"
    exit 1
esac

$FPM -m thomas@scm.io -s dir -t $PKG_TYPE -n $PROJECT -v $VERSION --iteration $ITERATION \
--before-install=buildtools/before-install.sh --after-install=buildtools/after-install.sh \
--before-remove=buildtools/before-remove.sh --after-remove=buildtools/after-remove.sh --template-scripts \
--template-value init_system=$INIT_SYSTEM -C $DIST_DIR/rootenv usr/ etc/

popd