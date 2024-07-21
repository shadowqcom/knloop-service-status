rm -rf knloop-service-status/
git clone git@github.com:shadowqcom/knloop-service-status.git
cd ./knloop-service-status/
bash ./src/servicecheck.sh
git config --local user.name 'Other Actions'
git config --local user.email 'OtherActions@knloop.com'
git add -A --force ./logs/
git commit -m '🆙 [hongkong tencent] Update service status logs'
git push origin main
cd ..
rm -rf knloop-service-status/