#!/bin/sh

commit=true
origin=$(git remote get-url origin)
if [ "$origin" = *statsig-io/statuspage* ]; then
  commit=false
fi

# 创建两个数组的模拟，使用索引变量来跟踪
i=0
# keysarray=
# urlsarray=

urlsconfig="./urls.cfg"
echo "Reading $urlsconfig"
while read -r line; do
  echo "  $line"
  key=$(echo $line | cut -d'=' -f1)
  url=$(echo $line | cut -d'=' -f2)
  keysarray[$i]=$key
  urlsarray[$i]=$url
  ((i++))
done < "$urlsconfig"

echo "***********************"
echo "Starting health checks with $i configs:"

mkdir -p logs

# 设置时区
export TZ=Asia/Shanghai

for ((j=0; j<i; j++)); do
  key=${keysarray[$j]}
  url=${urlsarray[$j]}
  echo "  $key=$url"

  for ((k=1; k<=4; k++)); do
    response=$(curl --write-out '%{http_code}' --silent --output /dev/null $url)
    if [ "$response" -eq 200 ] || [ "$response" -eq 202 ] || [ "$response" -eq 301 ] || [ "$response" -eq 302 ] || [ "$response" -eq 307 ]; then
      result="success"
    else
      result="failed"
    fi
    if [ "$result" = "success" ]; then
      break
    fi
    sleep 5
  done
  dateTime=$(date +'%Y-%m-%d %H:%M')
  if [ "$commit" = true ]; then
    echo $dateTime, $result >> "logs/${key}_report.log"
    # 保持最近2000条记录
    awk 'NR>2000 {print $0}' "logs/${key}_report.log" > "logs/${key}_report.log.tmp" && mv "logs/${key}_report.log.tmp" "logs/${key}_report.log"
  else
    echo "    $dateTime, $result"
  fi
done

if [ "$commit" = true ]; then
  git config --global user.name unclejee
  git config --global user.email swatxhim@outlook.com
  git add logs/
  git commit -m '[Automated] Update Health Check Logs'
  git push
fi