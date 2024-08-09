#!/bin/bash

export TZ='Asia/Shanghai'

# 检查是否有仓库。
if [ ! -d "./knloop-service-status/" ]; then
    git clone git@github.com:shadowqcom/knloop-service-status.git
fi

cd ./knloop-service-status/
git checkout -b page origin/page > /dev/null 2>&1
git pull origin page > /dev/null 2>&1
sudo bash ./checkshell/servicecheck-local.sh

# 如果./tmp/logs文件夹为空
if [ ! -d "./tmp/logs" ]; then
    echo "没有检测到日志文件，终止后续动作。"
    exit 0
fi

KEYSARRAY=()

urlsConfig="./src/urls.cfg"

# 从配置文件中读取键
mapfile -t KEYSARRAY < <(grep -v '^#' "$urlsConfig" | cut -d '=' -f 1)

random_number=$((RANDOM % ${#KEYSARRAY[@]}))
key=${KEYSARRAY[$random_number]}
first_line=$(head -n 1 "./tmp/logs/${key}_report.log")
timestamp=$(echo "$first_line" | awk '{print $1 " " $2}')
statrtime="${timestamp%,}"

# 获取当前时间
dateTime=$(date +'%Y-%m-%d %H:%M')

# 将时间戳转换为 Unix 时间戳（秒）
startTime=$(date -d "$statrtime" +%s)
currentTime=$(date -d "$dateTime" +%s)

# 计算时间差
timeDifference=$((currentTime - startTime))
minute=$((timeDifference / 60))

# 每180分钟提交一次
if [ $minute -lt 180 ]; then
    echo "时间间隔太短，暂不提交。"
    exit 0
fi

# 拉取最新代码
git pull origin page

# 整理和排序 确保文件按照时间顺序排列
for key in "${KEYSARRAY[@]}"; do
    # 提取最后30行并保存到临时文件
    tail -n 30 "./logs/${key}_report.log" > "./tmp/logs/${key}_report.log.tmp"

    # 删除原文件的末尾 30 行
    head -n -30 "./logs/${key}_report.log" > "./logs/${key}_report.log.new"
    mv "./logs/${key}_report.log.new" "./logs/${key}_report.log"

    # 将临时文件中的行合并到临时日志文件
    cat "./tmp/logs/${key}_report.log.tmp" >> "./tmp/logs/${key}_report.log"

    # 对临时日志文件进行排序
    sort -t ',' -k1,1 -k2,2n "./tmp/logs/${key}_report.log" > "./tmp/logs/${key}_report.log.sorted"

    # 将排序后的行追加到主日志文件中
    cat "./tmp/logs/${key}_report.log.sorted" >> "./logs/${key}_report.log"
    
    # 清理临时文件
    rm -f "./tmp/logs/${key}_report.log.tmp"
    rm -f "./logs/${key}_report.log.new"
    rm -f "./tmp/logs/${key}_report.log.sorted"
done

# 配置用户信息并提交到page分支
git config --local user.name 'Hongkong Actions'
git config --local user.email 'Hongkongactions@knloop.com'
git add -A --force ./logs/
git commit -m '🆙 [Hongkong Actions] Update service status logs'
git push origin page
rm -f ./tmp/logs/*