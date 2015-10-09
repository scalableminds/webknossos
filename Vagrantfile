# -*- mode: ruby -*-
# vi: set ft=ruby :


Vagrant.configure(2) do |config|
  config.vm.box = 'ubuntu/trusty64'

  config.vm.network "forwarded_port", guest: 9000, host: 5000
  config.vm.provider 'virtualbox' do |vb|
    vb.memory = 4096
    vb.cpus = 2
  end

  config.vm.provision 'shell', inline: <<-SHELL
    sudo apt-add-repository multiverse
    sudo apt-add-repository universe


    # Adding repository for sbt 
    echo "deb https://dl.bintray.com/sbt/debian /" | sudo tee -a /etc/apt/sources.list.d/sbt.list
    sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 642AC823

    sudo apt-get update
    sudo apt-get install -y openjdk-7-jdk mongodb-server nodejs nodejs-legacy sbt npm

    sudo npm install -g coffee-script less bower gulp
  SHELL
end
