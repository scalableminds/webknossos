#!/bin/bash
set -e

#check for existing environment variables
: ${WORKSPACE:?"Need non-empty WORKSPACE variable"}
: ${JENKINS_HOME:?"Need non-empty JENKINS_HOME variable"}

if [ $# -lt 3 ]; then
echo "Usage: $0 <project> <branch> <iteration> "
  exit 1
fi

PROJECT=${1}
BRANCH=${2}
ITERATION=${3}
NAME=${PROJECT}-${BRANCH}

RELATIVE_TEMPLATE_DIR=`dirname $0`
TEMPLATE_DIR=`readlink -f ${RELATIVE_TEMPLATE_DIR}`/templates

LOGDIR=/var/log/${NAME}
#change to git root
pushd ${WORKSPACE}

if [ "$PROJECT" == "oxalis" ]; then
  PROJECT_DIR="."
else
  PROJECT_DIR="${PROJECT}"
fi

pushd ${PROJECT_DIR}

echo "compiling application..."
sbt clean compile stage || (echo "error creating package, aborting ..."; exit 1)
APP_DIR=target/universal/stage
chmod +x $APP_DIR/bin/${PROJECT}

echo "creating root environment..."
ROOT_ENV="rootenv"
INSTALL_DIR="/usr/lib/${NAME}"
mkdir -p ${ROOT_ENV}${INSTALL_DIR}
cp -r ${APP_DIR}/* ${ROOT_ENV}${INSTALL_DIR}

echo "building packages..."
#go back to git root again
popd

for PKG_TYPE in "deb" "rpm"
do
  if [ $PKG_TYPE = "deb" ]; then
    CONFIG_ADDONS="--deb-user root --deb-group root"
  fi

  fpm ${CONFIG_ADDONS} -m thomas@scm.io -s dir -t $PKG_TYPE \
    -n ${NAME} \
    -v $VERSION \
    --iteration $ITERATION \
    --provides ${NAME} \
    --before-install="${TEMPLATE_DIR}/before-install.sh" \
    --after-install="${TEMPLATE_DIR}/after-install.sh" \
    --after-remove="${TEMPLATE_DIR}/after-remove.sh" \
    --template-scripts \
    --template-value logdir="${LOGDIR}" \
    --template-value group="${PROJECT}" \
    --template-value user="${NAME}" \
    --template-value installdir="${INSTALL_DIR}" \
    -C ${PROJECT_DIR}/${DIST_DIR}/rootenv usr/
done

popd
