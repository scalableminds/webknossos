#!/bin/bash

set -e

#check for existing environment variables
: ${WORKSPACE:?"Need non empty WORKSPACE variable"}
: ${NEWRELIC_LICENSE_KEY:?"Need non empty NEWRELIC_LICENSE_KEY variable"}

if [ $# -lt 6 ];then
  echo "Usage: <project> <branch> <build-number> <port> <mode> <pkg-type>"
  exit 1
fi

if [ `python2.7 -c "import jinja2"` ]; then
  echo "This scrips needs jinja2 for template rendering, aborting ..."
  exit 1
fi

PROJECT=${1}
BRANCH=${2}
BUILD_NUMBER=${3}
PORT=${4}
MODE=${5}
PKG_TYPE=${6}

NAME=${PROJECT}-${BRANCH}
APP_VERSION=${VERSION}
VERSION="0.1"
BUILD_NAME="${NAME}-helper-${BUILD_NUMBER}-${MODE}"
RELATIVE_TEMPLATE_DIR=`dirname $0`
TEMPLATE_DIR=`readlink -f ${RELATIVE_TEMPLATE_DIR}`/templates

pushd ${WORKSPACE}

ROOT_ENV="${BUILD_NAME}"
PACKAGE="${BUILD_NAME}.${PKG_TYPE}"

APP_INSTALL_DIR="usr/lib/${NAME}"

if [ -d $ROOT_ENV ]; then
  echo "cleaning prior root_env"
  rm -r $ROOT_ENV
fi

mkdir -p ${ROOT_ENV}
mkdir -p ${ROOT_ENV}/etc

if [ -f $PACKAGE ]; then
  echo "removing existing package"
  rm $PACKAGE
fi


# NGINX
  NGINX_PATH="${ROOT_ENV}/etc/nginx"
  NGINX_AVAILABLE_VHOSTS="${NGINX_PATH}/sites-available"
  NGINX_ENABLED_VHOSTS="${NGINX_PATH}/sites-enabled"
  mkdir -p $NGINX_AVAILABLE_VHOSTS
  mkdir -p $NGINX_ENABLED_VHOSTS
  NGINX_VHOST_NAME="${PROJECT}-${BRANCH}.vhost"
  NGINX_VHOST="${NGINX_AVAILABLE_VHOSTS}/${NGINX_VHOST_NAME}"

  if [ $MODE = "prod" ]; then
    DOMAIN_AND_TLD='webknossos.brain.mpg.de'
  else
    DOMAIN_AND_TLD='oxalis.at'
  fi


  NGINX_TEMPLATE=$(< ${TEMPLATE_DIR}/nginx_template)
  python2.7 -c "import jinja2; print jinja2.Template(\"\"\"$NGINX_TEMPLATE\"\"\").render(\
    project=\"$PROJECT\", branch=\"$BRANCH\", port=\"$PORT\", mode=\"$MODE\", domain_and_tld=\"$DOMAIN_AND_TLD\")" > $NGINX_VHOST
  ln -s ../sites-available/${NGINX_VHOST_NAME} $NGINX_ENABLED_VHOSTS/


# LOGGING
  LOG_FILE="/var/log/${NAME}/${NAME}"
  mkdir -p ${ROOT_ENV}/${APP_INSTALL_DIR}

if [ "$PKG_TYPE" = "rpm" ];then
  LOGGER="filelogger"
  LOGGER_XML_TEMPLATE=$(< ${TEMPLATE_DIR}/filelogger_template)
elif [ "$PKG_TYPE" = "deb" ]; then
  LOGGER="syslogger"
  LOGGER_XML_TEMPLATE=$(< ${TEMPLATE_DIR}/syslogger_template)

  # rsyslog config
  RSYSLOG_D="${ROOT_ENV}/etc/rsyslog.d"
  mkdir -p $RSYSLOG_D
  RSYSLOG_TEMPLATE=$(< ${TEMPLATE_DIR}/rsyslog_template)
  RSYSLOG_CONFIG="${RSYSLOG_D}/${NAME}.conf"
  python2.7 -c "import jinja2; print jinja2.Template(\"\"\"$RSYSLOG_TEMPLATE\"\"\").render(\
    project=\"$PROJECT\", branch=\"$BRANCH\", log_file=\"$LOG_FILE\", mode=\"$MODE\")" > $RSYSLOG_CONFIG

  #logrotation
  LOGROTATE_D="${ROOT_ENV}/etc/logrotate.d"
  mkdir -p $LOGROTATE_D
  LOGROTATE_TEMPLATE=$(< ${TEMPLATE_DIR}/logrotate_template)
  LOGROTATE_CONFIG="${LOGROTATE_D}/${NAME}"
  python2.7 -c "import jinja2; print jinja2.Template(\"\"\"$LOGROTATE_TEMPLATE\"\"\").render(\
    log_file=\"$LOG_FILE\")" > $LOGROTATE_CONFIG
fi
LOGGER_XML="${ROOT_ENV}/${APP_INSTALL_DIR}/${LOGGER}.xml"
python2.7 -c "import jinja2; print jinja2.Template(\"\"\"$LOGGER_XML_TEMPLATE\"\"\").render(\
project=\"$PROJECT\", branch=\"$BRANCH\", log_file=\"$LOG_FILE\", mode=\"$MODE\")" > $LOGGER_XML

NEWRELIC_CONFIG_PATH="${ROOT_ENV}/${APP_INSTALL_DIR}/conf/newrelic.yml"
NEWRELIC_TEMPLATE=$(< ${TEMPLATE_DIR}/newrelic_template)
NEWRELIC_AGENT_VERSION=$(cat project/Build.scala | python2.7 -c \
  "import re, sys; print re.search('com\.newrelic\.agent\.java.+(\d+\.\d+\.\d+)', sys.stdin.read()).group(1)")
mkdir -p ${ROOT_ENV}/${APP_INSTALL_DIR}/conf
python2.7 -c "import jinja2; print jinja2.Template(\"\"\"$NEWRELIC_TEMPLATE\"\"\").render(\
project=\"$PROJECT\", branch=\"$BRANCH\", newrelic_license_key=\"$NEWRELIC_LICENSE_KEY\", mode=\"$MODE\")" > $NEWRELIC_CONFIG_PATH


# Init
if [ "$PKG_TYPE" = "deb" ]; then
  INIT_LOCATION="${ROOT_ENV}/etc/init.d"
  INIT_SCRIPT="${INIT_LOCATION}/${NAME}"
  TEMPLATE=$(< ${TEMPLATE_DIR}/sysvinit_template)
elif [ "$PKG_TYPE" = "rpm" ]; then
  INIT_LOCATION="${ROOT_ENV}/usr/lib/systemd/system"
  INIT_SCRIPT="${INIT_LOCATION}/${NAME}.service"
  TEMPLATE=$(< ${TEMPLATE_DIR}/systemd_template)
else
  echo "Bad package-type: $PKG_TYPE, aborting..."
  exit 1
fi
  JMX_PORT=0
  if [ "$MODE" = "prod" ];then
    # Ports are also defined in pillar/datadog.sls (not dry but does the job)
    case "$PROJECT-$BRANCH" in
      oxalis-master)
        JMX_PORT=30000
        ;;
      levelcreator-master)
        JMX_PORT=30001
        ;;
      director-master)
        JMX_PORT=30002
        ;;
    esac
  fi
  mkdir -p "$INIT_LOCATION"
  LOGGER_XML_ABSPATH="/${LOGGER_XML#*/}"
  python2.7 -c "import jinja2; print jinja2.Template(\"\"\"$TEMPLATE\"\"\").render(\
  project=\"$PROJECT\", branch=\"$BRANCH\", port=\"$PORT\", mode=\"$MODE\", loggerXML=\"$LOGGER_XML_ABSPATH\", \
  jmx_port=$JMX_PORT , app_version=\"$APP_VERSION\", newrelic_agent_version=\"$NEWRELIC_AGENT_VERSION\")" > $INIT_SCRIPT

#start script with dummy db import
if [ $PROJECT == "oxalis" -a $MODE == "dev" -a $BRANCH == "dummy-db" ]; then
  DUMMY_START_SCRIPT=${ROOT_ENV}/${APP_INSTALL_DIR}/bin/startWithDummyDB.sh
  mkdir -p `dirname $DUMMY_START_SCRIPT`
  TEMPLATE=$(< ${TEMPLATE_DIR}/startWithDummyDB.sh)
  python2.7 -c "import jinja2; print jinja2.Template(\"\"\"$TEMPLATE\"\"\").render(name=\"$NAME\")" > $DUMMY_START_SCRIPT
  chmod +x $DUMMY_START_SCRIPT

  cp -r dummy-db ${ROOT_ENV}/${APP_INSTALL_DIR}
fi

if [ "$PKG_TYPE" = "deb" ]; then
  chmod +x ${INIT_SCRIPT}
fi

if [ "$PKG_TYPE" = "deb" ];then
  CONFIG_ADDONS="--deb-user root --deb-group root"
fi

fpm ${CONFIG_ADDONS} -m thomas@scm.io -s dir -t $PKG_TYPE \
-n ${PROJECT}-${BRANCH}-helper \
-p ${PACKAGE} \
-v $VERSION \
--iteration ${BUILD_NUMBER} \
--description "A helper package providing templated config files" \
--after-install="${TEMPLATE_DIR}/helper-after-install.sh" \
--before-remove="${TEMPLATE_DIR}/helper-before-remove.sh" \
--after-remove="${TEMPLATE_DIR}/helper-after-remove.sh" \
--template-scripts \
--template-value application="${PROJECT}-${BRANCH}" \
--template-value group="${PROJECT}" \
--template-value user="${PROJECT}-${BRANCH}" \
--template-value pkgType="${PKG_TYPE}" \
-C ${ROOT_ENV} etc/ usr/

popd
