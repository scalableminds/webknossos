#!/usr/bin/env bash
start_webknossos() {
	java -Dconfig.file=my-datastore.conf -jar webknossos-datastore.jar
	status=$?
	if [[ status -eq 250 ]]; then
		echo "Restarting webKnossos"
		mv update.jar webknossos-datastore.jar
		if [[ -f "update.sh" ]]; then
			chmod +x update.sh
			exec ./update.sh
		else
			start_webknossos
		fi
	else
		echo "Exiting webKnossos"
		exit $status
	fi
}

if [[ $0 == *"update.sh" ]]; then
	mv update.sh run.sh
fi

start_webknossos
