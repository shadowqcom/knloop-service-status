rm -rf knloop-service-status/
git clone git@github.com:shadowqcom/knloop-service-status.git
cd ./knloop-service-status/
bash ./src/servicecheck.sh
git add -A --force ./logs/
git commit -m '🆙 [centos] Update service status logs'
git push origin main
cd ..
rm -rf knloop-service-status/