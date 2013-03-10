#!/bin/bash

AWS_CONF=modules/levelcreator/conf/aws.conf
AWS_CONF_DISABLED=${AWS_CONF}.disabled

case "$1" in
	enable)
		if [ -f $AWS_CONF_DISABLED ]
		then
			mv $AWS_CONF_DISABLED $AWS_CONF 
			echo "enabled s3upload"
		fi
		;;
	disable)
		if [ -f $AWS_CONF ]
		then
			mv $AWS_CONF $AWS_CONF_DISABLED
			echo "disabled s3upload"
		fi
		;;
	*)
		echo "Usage: $0 <enable/disable>"
		;;	
esac