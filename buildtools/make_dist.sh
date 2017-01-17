#!/bin/bash
set -ex

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

APP_DIR=target/universal/stage

echo "creating root environment..."
ROOT_ENV="rootenv"
INSTALL_DIR="/usr/lib/${NAME}"
mkdir -p ${ROOT_ENV}${INSTALL_DIR}
cp -r ${APP_DIR}/* ${ROOT_ENV}${INSTALL_DIR}
rm ${ROOT_ENV}${INSTALL_DIR}/conf/newrelic.yml
chmod +x ${ROOT_ENV}${INSTALL_DIR}/bin/${PROJECT}

echo "building packages..."
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
    -C ./${DIST_DIR}/rootenv usr/
done

popd
