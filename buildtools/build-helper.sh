#!/bin/sh

if [ $# -lt 4 ];then
  echo "Usage: <mode> <project> <branch> <port>"
  exit 1
fi 

if [ `python2 -c "import jinja2"` ]; then
  echo "This scrips needs jinja2 for template rendering, aborting ..."
  exit 1
fi

MODE=${1}
PROJECT=${2}
BRANCH=${3}
PORT=${4}

VERSION="0.1"
PKG_TYPE="deb"
ROOT_ENV="`dirname $0`/rootenv"
APP_INSTALL_DIR="usr/lib/${PROJECT}-${BRANCH}"

if [ -d $ROOT_ENV ]; then
  rm -r $ROOT_ENV
fi 

# SysvInit script

mkdir -p $ROOT_ENV/etc/init.d/
SYSVINIT_SCRIPT=$ROOT_ENV/etc/init.d/$PROJECT-$BRANCH

SYSVINIT_TEMPLATE=`cat sysvinit_template`
python2 -c "import jinja2; print jinja2.Template(\"\"\"$SYSVINIT_TEMPLATE\"\"\").render(\
  project=\"$PROJECT\", branch=\"$BRANCH\", port=\"$PORT\", mode=\"$MODE\")" > $SYSVINIT_SCRIPT
chmod +x $SYSVINIT_SCRIPT

#Nginx vhost

NGINX_PATH="${ROOT_ENV}/etc/nginx"
NGINX_AVAILABLE_VHOSTS="${NGINX_PATH}/sites-available"
NGINX_ENABLED_VHOSTS="${NGINX_PATH}/sites-enabled"
mkdir -p $NGINX_AVAILABLE_VHOSTS
mkdir -p $NGINX_ENABLED_VHOSTS
NGINX_VHOST_NAME="${PROJECT}-${BRANCH}.vhost"
NGINX_VHOST="${NGINX_AVAILABLE_VHOSTS}/${NGINX_VHOST_NAME}"

URL_REGEX=""
PRODUCTION_URL_PREFIX="~^(www\.)?"
DEVELOPMENT_URL_PREFIX="~^$BRANCH\."

if [ $PROJECT = "oxalis" ];then
  DOMAIN_AND_TLD='oxalis\.at$'
elif [ $Project = "levelcreator" ]; then
  DOMAIN_AND_TLD='levelcreator\.org$'
elif [ $PROJECT = "brainflight-director"]; then
  DOMAIN_AND_TLD='director\.brainflight\.org$'
else 
  echo "Bad Project name: $PROJECT"
  echo "Currently supported: oxalis, levelcreator and brainflight-director"
  exit 1
fi

if [ $MODE = "prod" ];then
  URL_REGEX=${PRODUCTION_URL_PREFIX}${DOMAIN_AND_TLD}
elif [ $MODE = "dev" ]; then
  URL_REGEX=${DEVELOPMENT_URL_PREFIX}${DOMAIN_AND_TLD}
else 
  echo "Bad mode: $MODE"
  echo "Currently supported: prod, dev"
  exit 1
fi

NGINX_TEMPLATE=`cat nginx_template`
python2 -c "import jinja2; print jinja2.Template(\"\"\"$NGINX_TEMPLATE\"\"\").render(\
  url_regex=\"$URL_REGEX\", project=\"$PROJECT\", branch=\"$BRANCH\", port=\"$PORT\", mode=\"$MODE\")" > $NGINX_VHOST
ln -s ../sites-available/${NGINX_VHOST_NAME} $NGINX_ENABLED_VHOSTS/

# Logger xml
mkdir -p ${ROOT_ENV}/${APP_INSTALL_DIR}
LOGGER_XML_TEMPLATE=`cat logger_xml_template`
LOGGER_XML="${ROOT_ENV}/${APP_INSTALL_DIR}/logger.xml"
python2 -c "import jinja2; print jinja2.Template(\"\"\"$LOGGER_XML_TEMPLATE\"\"\").render(\
  project=\"$PROJECT\", branch=\"$BRANCH\")" > $LOGGER_XML

# rsyslog config
RSYSLOG_D="${ROOT_ENV}/etc/rsyslog.d"
mkdir -p $RSYSLOG_D
RSYSLOG_TEMPLATE=`cat rsyslog_template`
RSYSLOG_CONFIG="${RSYSLOG_D}/${PROJECT}-${BRANCH}.conf"
python2 -c "import jinja2; print jinja2.Template(\"\"\"$RSYSLOG_TEMPLATE\"\"\").render(\
  project=\"$PROJECT\", branch=\"$BRANCH\")" > $RSYSLOG_CONFIG

fpm -m thomas@scm.io -s dir -t $PKG_TYPE -n ${PROJECT}-${BRANCH}-helper -v $VERSION --after-install="`dirname $0`/helper-after-install.sh" --before-remove="`dirname $0`/helper-before-remove.sh" --after-remove="`dirname $0`/helper-after-remove.sh" --template-scripts --template-value application="${PROJECT}-${BRANCH}" -C ${ROOT_ENV} etc/ usr/