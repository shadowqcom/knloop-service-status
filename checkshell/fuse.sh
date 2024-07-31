#!/bin/bash

curl -O https://raw.githubusercontent.com/shadowqcom/knloop-service-status/main/checkshell/actions-local.sh
chmod +x ./actions-local.sh
sudo bash ./actions-local.sh
rm -f ./actions-local.sh