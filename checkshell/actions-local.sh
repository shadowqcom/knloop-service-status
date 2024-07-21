# 这个脚本放在本地或者服务器运行。
# 前置条件是配置好了git，并且对仓库有读写权限。
rm -rf ./knloop-service-status/
git clone git@github.com:shadowqcom/knloop-service-status.git
cd ./knloop-service-status/
bash ./checkshell/servicecheck.sh
cd ..
rm -rf ./knloop-service-status/