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
    s"""#!/usr/bin/env bash
       |set -euo pipefail
       |
       |retry() {
       |	read -r variable
       |
       |	if eval "$$1"; then
       |		echo "$$2" >"$$(tty)"
       |		echo "Please try again!" >"$$(tty)"
       |		retry "$$1" "$$2"
       |	else
       |		echo "$$variable"
       |	fi
       |}
       |
       |make_file_path_absolute() {
       |  echo "$$(cd "$$(dirname "$$1")"; pwd)/$$(basename "$$1")"
       |}
       |
       |declare -A config_keys
       |config_keys[uri]=http.uri
       |config_keys[port]=https.port
       |config_keys[key]=datastore.key
       |config_keys[name]=datastore.name
       |config_keys[webKnossos]=datastore.webKnossos.uri
       |config_keys[single_org_datastore]=datastore.singleOrganizationDatastore.enabled
       |config_keys[org_name]=datastore.singleOrganizationDatastore.organizationName
       |config_keys[base_dir]=datastore.baseFolder
       |config_keys[key_store_path]=play.server.https.keyStore.path
       |config_keys[key_store_password]=play.server.https.keyStore.password
       |config_keys[ephemeral_key_size]=jdk.tls.ephemeralDHKeySize
       |config_keys[reject_client_renegotiation]=jdk.tls.rejectClientInitiatedRenegotiation
       |config_keys[watchFileSystem]=datastore.watchFileSystem.enabled
       |
       |declare -A config_values
       |
       |config_values[uri]=$url
       |config_values[port]=$port
       |config_values[key]=$key
       |config_values[name]=$name
       |config_values[webKnossos]=$webKnossosUrl
       |config_values[single_org_datastore]="true"
       |config_values[org_name]=$organizationName
       |config_values[ephemeral_key_size]="2048"
       |config_values[reject_client_renegotiation]="true"
       |
       |update_script=$updateScriptURL
       |jar=$jarURL
       |
       |echo "This script helps you to install a webKnossos datastore on your machine. In the progress some commands may need root permissions, but these are not required. If you have to abort the installation, you can simply restart process and all necessary files will be overwritten."
       |
       |echo "Please enter the installation path and press [ENTER] or simply press [ENTER] if the datastore should be installed in the current directory: "
       |
       |install_path=$$(retry "[[ ! -z \\$$variable && ! -d \\$$variable ]]" "The provided installation path does not exist or is not a directory.")
       |
       |if [[ -z $$install_path ]]; then
       |	install_path="$$(pwd)"
       |else
       | install_path=$$(make_file_path_absolute "$$install_path")
       |fi
       |
       |echo "Downloading the necessary files..."
       |curl -L -H "Accept: application/octet-stream" -o "$$install_path/webknossos-datastore.jar" $$jar
       |curl -L -H "Accept: application/octet-stream" -o "$$install_path/run.sh" $$update_script
       |chmod +x "$$install_path/run.sh"
       |
       |echo "Downloaded all necessary files."
       |
       |echo "Creating initial config. We will ask for some of the most important config fields, but there are more configuration options. Please consult the documentation at TODO to learn more."
       |echo "Please enter the path where the datasets are located and press [ENTER]:"
       |base_dir=$$(retry "[[ ! -d \\$$variable ]]" "The provided dataset path does not exist or is not a directory.")
       |
       |config_values[base_dir]=$$base_dir
       |
       |echo "The webKnossos datastore checks your file system periodically to discover new datasets. If you wish to disable this function, please type [n]. Otherwise, just press [ENTER]."
       |read -r -n 1 disableFileSystemWatching
       |echo
       |
       |if [[ $$disableFileSystemWatching == "n" ]]; then
       |	config_values[watchFileSystem]="false"
       |else
       |	config_values[watchFileSystem]="true"
       |fi
       |
       |echo "To use your own webKnossos datastore, it must support HTTPS when communicating with the webKnossos server. There are multiple ways to implement this."
       |echo "Option 3 will guide you to retrieve a SSL certificate and automatically renew the certificate for you. However, this option requires root permissions. Please note that you have renew the certificate by yourself when not using option 3."
       |echo "1. You use your own proxy, e.g. nginx."
       |echo "2. You already setup HTTPS for your machine"
       |echo "3. You have not setup HTTPS yet."
       |echo "Please enter your option [1/2/3]."
       |
       |https_option=$$(retry "[[ !(\\$$variable == 1 || \\$$variable == 2 || \\$$variable == 3) ]]" "Unknown option")
       |
       |if [[ $$https_option == "1" ]]; then
       |	echo "Please update your webKnossos datastore config accordingly. You will need to change the HTTP configuration, namely the URI and the PORT."
       |	config_values[uri]="CHANGE_ME"
       |	config_values[port]="CHANGE_ME"
       |elif [[ $$https_option == "2" ]]; then
       |	echo "To enable the datastore to use your HTTPS configuration, it needs access to your key store and the corresponding password. You can enter these values now, but also change them later in the my-datastore.conf file."
       |	echo "Please enter the path to the key store and press [ENTER]."
       |	key_store_path=$$(retry "[[ ! -f \\$$variable ]]" "The provided key store path does not exist or is not a file.")
       |  key_store_path=$$(make_file_path_absolute "$$key_store_path")
       |	config_values[key_store_path]=$$key_store_path
       |
       |	echo "Please enter the password for the key store and press [ENTER]."
       |	read -r key_store_password
       |	config_values[key_store_password]=$$key_store_password
       |
       |elif [[ $$https_option == "3" ]]; then
       |	echo "Setting up HTTPS requires a few steps. First of all, we need to install some packages. These include socat, keytool, openssl, curl."
       |	echo "Do you wish to attempt to install these packages automatically? Type [y] or [n]. Please note that this script tries to use apt to install the packages. If that does not work, please install the packages by yourself and proceed afterwards."
       |	read -r -n 1 auto_install
       |	echo
       |
       |	if [[ $$auto_install == "y" ]]; then
       |		sudo apt install socat openssl curl
       |	else
       |		echo "Please press [ENTER] after installing all of the required packages."
       |		read -r auto_install
       |	fi
       |
       |	echo "Next, we need to tie your URL to a valid e-mail address to get a SSL certificate. Please provide a email address and press [ENTER]."
       |	email=$$(retry "[[ -z \\$$variable ]]" "Empty email is not allowed.")
       |
       |	curl https://get.acme.sh | sudo sh -s email="$$email"
       |
       |	sanitised_uri=$$(echo "$${config_values[uri]}" | cut -d "/" -f 3)
       |	password=$$(tr -dc A-Za-z0-9 </dev/urandom | head -c 20 ; echo '')
       |
       |	touch "$$install_path/renew_certificate.sh"
       |	rm "$$install_path/renew_certificate.sh"
       |
       |	echo "openssl pkcs12 -export -in ~/.acme.sh/$$sanitised_uri/fullchain.cer -inkey ~/.acme.sh/$$sanitised_uri/$$sanitised_uri.key -out $$install_path/cert_and_key.p12 -CAfile ~/.acme.sh/$$sanitised_uri/ca.cer -caname root -passout pass:test" >> "$$install_path/renew_certificate.sh"
       |	echo "keytool -importkeystore -destkeystore $$install_path/wKKeyStore.jks -srckeystore $$install_path/cert_and_key.p12 -srcstoretype PKCS12 -srcstorepass test -deststorepass $$password -noprompt" >> "$$install_path/renew_certificate.sh"
       |	echo "rm $$install_path/cert_and_key.p12" >> "$$install_path/renew_certificate.sh"
       |	chmod +x "$$install_path/renew_certificate.sh"
       |
       |	sudo ~/.acme.sh/acme.sh --issue -d "$$sanitised_uri" --standalone --reloadcmd "$$install_path/renew_certificate.sh"
       |
       |	config_values[key_store_path]=$$install_path/wKKeyStore.jks
       |	config_values[key_store_password]=$$password
       |fi
       |
       |echo "In case the HTTPS setup fails, you can always change the play.server.https.keyStore values in the my-datastore.conf file. If you need more information regarding the HTTPS setup, please consult the documentation."
       |
       |echo "Generating config file"
       |touch "$$install_path/my-datastore.conf"
       |rm "$$install_path/my-datastore.conf"
       |
       |echo "include \\"/standalone-datastore.conf\\"" >> "$$install_path/my-datastore.conf"
       |
       |for i in "$${!config_values[@]}"
       |do
       |	echo "$${config_keys[$$i]} = \\"$${config_values[$$i]}\\"" >> "$$install_path/my-datastore.conf"
       |done
       |
       |echo "Generated config file"
       |
       |echo "Additionally, the webKnossos datastore can be installed as a systemd service. This allows startup on boot and restarts on failure. To configure the service, you'll need root privileges."
       |echo "Do you want to install the webKnossos datastore as a systemd service? Type [y] or [n]"
       |
       |read -r -n 1 install_service
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
       |	echo "$$service_file_definition" > webknossos-datastore.service
       |	chmod 640 webknossos-datastore.service
       |	sudo chown root webknossos-datastore.service
       |	sudo chgrp root webknossos-datastore.service
       |	sudo mv webknossos-datastore.service /etc/systemd/system/
       |	sudo systemctl daemon-reload
       |
       |	echo "Do you wish to enable startup on boot? Type [y] or [n]"
       |	read -r -n 1 startup_on_boot
       |	echo
       |
       |	if [[ $$startup_on_boot == "y" ]]; then
       |		sudo systemctl enable webknossos-datastore.service
       |	fi
       |
       |	echo "Do you wish to start the service now? You can always start the service later by calling \"sudo systemctl start webknossos-datastore.service\". Type [y] or [n]"
       |	read -r -n 1 start_now
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
       |echo "Installation completed! Your own webKnossos datastore is now ready to use. In case you experience any problems, please contact hello@webknossos.org."
       |echo "If you are not using the datastore as a service, simply execute the run.sh to start it."
       |""".stripMargin
}
