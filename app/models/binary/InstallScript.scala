package models.binary

object InstallScript {
  def getInstallScript(name: String,
                       url: String,
                       port: String,
                       organizationName: String,
                       key: String,
                       webKnossosUrl: String,
                       updateScriptURL: String,
                       jarURL: String): String =
    s"""#!/bin/bash
       |set -euo pipefail
       |
       |declare -A config_keys
       |config_keys[uri]=http.uri
       |config_keys[port]=http.port
       |config_keys[key]=datastore.key
       |config_keys[name]=datastore.name
       |config_keys[webKnossos]=datastore.webKnossos.uri
       |config_keys[org_name]=datastore.singleOrganizationDatastore.organizationName
       |config_keys[base_dir]=datastore.baseFolder
       |config_keys[key_store_path]=play.server.https.keyStore.path
       |config_keys[key_store_password]=play.server.https.keyStore.password
       |config_keys[ephemeral_key_size]=jdk.tls.ephemeralDHKeySize
       |config_keys[reject_client_renegotiation]=jdk.tls.rejectClientInitiatedRenegotiation
       |config_keys[watchFileSystem]=datastore.watchFileSystem
       |
       |declare -A config_values
       |
       |config_values[uri]=$url
       |config_values[port]=$port
       |config_values[key]=$key
       |config_values[name]=$name
       |config_values[webKnossos]=$webKnossosUrl
       |config_values[org_name]=$organizationName
       |config_values[ephemeral_key_size]="2048"
       |config_values[reject_client_renegotiation]="true"
       |
       |update_script=$updateScriptURL
       |jar=$jarURL
       |
       |echo "This script helps you to install a webKnossos Datastore on your machine. In the progress some commands may need root permissions, but these are not required."
       |
       |echo "Please enter the installation path and press [ENTER] or simply press [ENTER] if the Datastore should be installed in the current directory: "
       |
       |read install_path
       |
       |if [[ -z $$install_path ]]; then
       |	install_path="`pwd`"
       |fi
       |
       |if [[ !(-d $$install_path) ]]; then
       |	echo "The provided installation path does not exist or is not a directory."
       |	exit 1
       |fi
       |
       |echo "Downloading the necessary files..."
       |curl -L -H "Accept: application/octet-stream" -o webknossos.jar $$jar
       |curl -L -H "Accept: application/octet-stream" -o run.sh $$update_script
       |chmod +x run.sh
       |
       |echo "Downloaded all necessary files."
       |
       |echo "Creating initial config. We will ask for some of the most important config fields, but there are more configuration options. Please consult the documentation at TODO to learn more."
       |echo "Please enter the path where the datasets are located and press [ENTER]:"
       |read base_dir
       |
       |config_values[base_dir]=$$base_dir
       |
       |if [[ -z $${config_values[base_dir]} ]]; then
       |	echo "Please enter a valid path that is not empty."
       |	exit 1
       |else
       |	# mkdir -p config_values[base_dir]
       |	if [[ ! (-d $${config_values[base_dir]}) ]]; then
       |		echo "The provided dataset path does not exist or is not a directory. Please provide a valid path."
       |		exit 1
       |	fi
       |fi
       |
       |echo "webKnossos checks your file system periodically to discover new datasets. If you wish to disable this function, please type [n]. Otherwise, just press [ENTER]."
       |read -n 1 disableFileSystemWatching
       |echo
       |
       |if [[ $$disableFileSystemWatching == "n" ]]; then
       |	config_values[watchFileSystem]="false"
       |else
       |	config_values[watchFileSystem]="true"
       |fi
       |
       |echo "To use your own webKnossos datastore, it must support HTTPS when communicating with the webKnossos server. There are multiple ways to implement this."
       |echo "1. You use your own proxy, e.g. nginx."
       |echo "2. You already setup HTTPS for your machine"
       |echo "3. You have not setup HTTPS yet."
       |echo "Please enter your option [1/2/3]."
       |
       |read -n 1 https_option
       |echo
       |
       |if [[ $$https_option == "1" ]]; then
       |	echo "Please update your webKnossos config accordingly. You will need to change the HTTP configuration, namely the URI and the PORT."
       |	config_values[uri]="CHANGE_ME"
       |	config_values[port]="CHANGE_ME"
       |elif [[ $$https_option == "2" ]]; then
       |	echo "To enable the datastore to use your HTTPS configuration, it needs access to your key store and the corresponding password. You can enter these values now, but also change them later in the my-datastore.conf file."
       |	echo "Please enter the path to the key store and press [ENTER]."
       |	read key_store_path
       |	config_values[key_store_path]=$$key_store_path
       |
       |	if [[ ! (-f $${config_values[key_store_path]}) ]]; then
       |		echo "The provided key store path does not exist or is not a file. Please provide a valid path."
       |		exit 1
       |	fi
       |
       |	echo "Please enter the password for the key store and press [ENTER]."
       |	read key_store_password
       |	config_values[key_store_password]=$$key_store_password
       |
       |elif [[ $$https_option == "3" ]]; then
       |	echo "Setting up HTTPS requires a few steps. First of all, we need to install some packages. These include socat, keytool, openssl, curl."
       |	echo "Do you wish to attempt to install these packages automatically? Type [y] or [n]. Please note that this script tries to use apt to install the packages. If that does not work, please install the packages by yourself and proceed afterwards."
       |	read -n 1 auto_install
       |	echo
       |
       |	if [[ $$auto_install == "y" ]]; then
       |		sudo apt install socat keytool openssl curl
       |	elif [[ $$auto_install == "n" ]]; then
       |		echo "Please press [ENTER] after installing all of the required packages."
       |		read auto_install
       |	else
       |		echo "Unknown option. Exiting..."
       |		exit 1
       |	fi
       |
       |	echo "Next, we need to tie your URL to a valid e-mail address to get a SSL certificate. Please provide a email address and press [ENTER]."
       |	read email
       |
       |	if [[ -z $$email ]]; then
       |		echo "Invalid email. Exiting..."
       |		exit 1
       |	fi
       |
       |	curl https://get.acme.sh | sh -s email=$$email
       |
       |	acme.sh --issue -d $$config_values[uri] --standalone
       |
       |	openssl pkcs12 -export -in .acme.sh/$$config_values[uri]/fullchain.cer -inkey .acme.sh/$$config_values[uri]/$$config_values[uri].key -out cert_and_key.p12 -CAfile .acme.sh/$$config_values[uri]/ca.cer -caname root -passout pass:test
       |
       |	keytool -importkeystore -destkeystore wKKeyStore.jks -srckeystore cert_and_key.p12 -srcstoretype PKCS12
       |
       |	rm cert_and_key.p12
       |
       |	config_values[key_store_path]=wKKeyStore.jks
       |	config_values[key_store_password]=testkeystorepassword
       |else
       |	echo "Unknown option"
       |	exit 1
       |fi
       |
       |echo "In case the HTTPS setup fails, you can always change the play.server.https.keyStore values in the my-datastore.conf file. If you need more information regarding the HTTPS setup, please consult the documentation."
       |
       |echo "Generating config file"
       |touch my-datastore.conf
       |
       |for i in "$${!config_values[@]}"
       |do
       |	echo "$${config_keys[$$i]} = $${config_values[$$i]}" >> my-datastore.conf
       |  # echo "key  : $$i"
       |  # echo "value: $${array[$$i]}"
       |done
       |
       |echo "Generated config file"
       |
       |echo "Additionally, webKnossos can be installed as a systemd service. This allows startup on boot and restarts on failure. To configure the service, you'll need root privileges."
       |echo "Do you want to install webKnossos as a systemd service? Type [y] or [n]"
       |
       |read -n 1 install_service
       |echo
       |
       |if [[ $$install_service == "y" ]]; then
       |	service_file_definition="
       |[Unit]
       |Description=webKnossos datastore module
       |
       |Wants=network.target
       |
       |[Service]
       |Type=simple
       |WorkingDirectory=$$install_path
       |ExecStart=$$install_path/run.sh
       |Restart=on-failure
       |RestartSec=10
       |KillMode=mixed
       |
       |[Install]
       |WantedBy=multi-user.target
       |"
       |
       |	echo $$service_file_definition > webknossos-datastore.service
       |	chmod 640 webknossos-datastore.service
       |	sudo chown root webknossos-datastore.service
       |	sudo chgrp root webknossos-datastore.service
       |	sudo mv webknossos-datastore.service /etc/systemd/system/
       |	sudo systemctl daemon-reload
       |
       |	echo "Do you wish to enable startup on boot? Type [y] or [n]"
       |	read -n 1 startup_on_boot
       |	echo
       |
       |	if [[ $$startup_on_boot == "y" ]]; then
       |		sudo systemctl enable webknossos-datastore.service
       |	fi
       |
       |	echo "Do you wish to start the service now? You can always start the service later by calling \"sudo systemctl start webknossos-datastore.service\". Type [y] or [n]"
       |	read -n 1 start_now
       |	echo
       |
       |	if [[ $$start_now == "y" ]]; then
       |		sudo systemctl start webknossos-datastore.service
       |	fi
       |
       |	echo "Service installation completed. To inspect the logs of the running webKnossos datastore module, you can use \"journalctl -u webknossos-datastore\" ."
       |
       |fi
       |
       |echo "Install completed! Have fun using your own webKnossos datastore."
       |""".stripMargin
}
