#!/bin/bash
start_webknossos() {
	java -Dconfig.file=my-datastore.conf -jar webknossos.jar
	status=$?
	if [[ status -eq 250 ]]; then
		echo "Restarting webKnossos"
		mv update.jar webknossos.jar
		start_webknossos
	else
		echo "Exiting webKnossos"
		exit $status
	fi
}

start_webknossos