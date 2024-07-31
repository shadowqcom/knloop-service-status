#!/bin/bash

# 这个脚本放在本地或者服务器运行。
# 前置条件是配置好了git，并且对仓库有读写权限。
# 建议把user.name、user.email、git commit -m的内容改成特定的，比较容易区分commits信息。

export TZ='Asia/Shanghai'

# 检查是否有仓库
if [ ! -d "./knloop-service-status/" ]; then
    git clone git@github.com:shadowqcom/knloop-service-status.git
fi

# 执行检测，得到临时logs
cd ./knloop-service-status/
git checkout -b page origin/page
git pull origin page
bash ./checkshell/servicecheck-local.sh

KEYSARRAY=()

urlsConfig="./src/urls.cfg"
while read -r line; do
    if [[ ${line} =~ ^\s*# ]] ; then
        continue
    fi
    IFS='=' read -ra TOKENS <<<"$line"
    KEYSARRAY+=(${TOKENS[0]})
done <"$urlsConfig"

random_number=$((RANDOM % ${#KEYSARRAY[@]}))
key=${KEYSARRAY[$random_number]}
first_line=$(head -n 1 "./logs/${key}_report.log")
timestamp=$(echo "$first_line" | awk '{print $1 " " $2}')
statrtime="${timestamp%,}"

# 获取当前时间
dateTime=$(date +'%Y-%m-%d %H:%M')

# 将时间戳转换为 Unix 时间戳（秒）
startTime=$(date -d "$statrtime" +%s)
currentTime=$(date -d "$dateTime" +%s)

# 计算时间差
timeDifference=$((currentTime - startTime))
hours=$((timeDifference / 360))

if [ $hours -lt 2 ]; then
    echo "无需提交"
    exit 0
fi

# GitHub API URL
githubapi="https://api.github.com/repos/shadowqcom/knloop-service-status/actions/runs"

# 使用 curl 下载 JSON 数据，并使用 head 和 tail 限制到第 5 行和第 15 行
json_data=$(curl -sSL $auth_header "$githubapi" | head -n 15 | tail -n +5)

echo $json_data

# 提取 name 和 status 字段
name=$(echo "$json_data" | grep -Po '"name"\s*:\s*"Service Status Check"' | grep -c "Service Status Check")
completed=$(echo "$json_data" | grep -Po '"status"\s*:\s*"completed"' | grep -c "completed")
in_progress=$(echo "$json_data" | grep -Po '"status"\s*:\s*"in_progress"' | grep -c "in_progress")

# 判断是否有actions在运行
if [ "$in_progress" -gt 0 ]; then
    echo "正在运行"
    exit 0
elif [ "$name" -gt 0 ] && [ "$completed" -gt 0 ]; then
    echo "未运行"
    # 拉取最新代码
    git pull origin page

    # 合并临时文件到本地仓库
    for ((index = 0; index < ${#KEYSARRAY[@]}; index++)); do
        key="${KEYSARRAY[index]}"
        cat ./tmp/logs/${key}_report.log >> ./logs/${key}_report.log
    done

    # 配置用户信息并提交到page分支
    git config --local user.name 'Github Actions'
    git config --local user.email 'actions@knloop.com'
    git add -A --force ./logs/
    git commit -m '🆙 [Automated] Update service status logs'
    git push origin page
    cd ..
fi