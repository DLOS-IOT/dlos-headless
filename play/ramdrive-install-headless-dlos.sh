#!/usr/bin/env bash

# only tested on ubuntu 16.4LTS with 32GB RAM
# don't forget to chmod a+x this file

sudo mkdir -p /media/ramdrive
mkdir -p ~/dlos
sudo mount -t tmpfs -o size=31G tmpfs /media/ramdrive/
cd /media/ramdrive
mkdir /media/ramdrive/dlos_app_storage

rm -rf ./dlos-headless
git clone https://github.com/DLOS-IOT/dlos-headless.git
cd dlos-headless
yarn

rm -rf ~/.config/dlos-headless
ln -s /media/ramdrive/dlos_app_storage ~/.config/dlos-headless

echo "exports.LOG_FILENAME = '/dev/null';" >> conf.js

node start.js

function finish {
  rsync -rue --info=progress2 /media/ramdrive ~/dlos
}

trap finish EXIT
