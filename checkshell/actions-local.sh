rm -rf ./knloop-service-status/
git clone git@github.com:shadowqcom/knloop-service-status.git
cd ./knloop-service-status/
bash ./src/servicecheck.sh
cd ..
rm -rf ./knloop-service-status/