#!/bin/bash

# 这个脚本放在本地或者服务器运行。
# 前置条件是配置好了git，并且对仓库有读写权限。
# 建议把user.name、user.email、git commit -m的内容改成特定的，比较容易区分commits信息。

# GitHub API URL
url="https://api.github.com/repos/shadowqcom/knloop-service-status/actions/runs"

# 使用 curl 下载 JSON 数据，并使用 head 和 tail 限制到第 5 行和第 15 行
json_data=$(curl -sSL $auth_header "$url" | head -n 15 | tail -n +5)

echo $json_data

# 提取 name 和 status 字段
# 使用 grep 和 awk 进行文本处理
name=$(echo "$json_data" | grep -Po '"name"\s*:\s*"Service Status Check"' | grep -c "Service Status Check")
completed=$(echo "$json_data" | grep -Po '"status"\s*:\s*"completed"' | grep -c "completed")
in_progress=$(echo "$json_data" | grep -Po '"status"\s*:\s*"in_progress"' | grep -c "in_progress")

# 判断是否有匹配项
if [ "$in_progress" -gt 0 ]; then
    echo "正在运行"
    exit 0
elif [ "$name" -gt 0 ] && [ "$completed" -gt 0 ]; then
    echo "未运行"
    rm -rf ./knloop-service-status/
    git clone git@github.com:shadowqcom/knloop-service-status.git
    cd ./knloop-service-status/
    git checkout -b page origin/page
    git pull origin page
    bash ./checkshell/servicecheck.sh
    git config --local user.name 'Github Actions'
    git config --local user.email 'actions@knloop.com'
    git add -A --force ./logs/
    git commit -m '🆙 [Automated] Update service status logs'
    git push origin page
    cd ..
    rm -rf ./knloop-service-status/
else
    echo "未知状态"
    exit 0
fi
