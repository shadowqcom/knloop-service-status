#!/bin/sh

commit=true
origin=$(git remote get-url origin)
if [ "$origin" = *statsig-io/statuspage* ]; then
  commit=false
fi

# 创建两个数组的模拟，使用索引变量来跟踪
i=0
declare -A keysarray
declare -A urlsarray

urlsconfig="./urls.cfg"
echo "Reading $urlsconfig"
while read -r line; do
  echo "  $line"
  IFS='=' read -ra tokens <<< "$line"
  keysarray[$i]=${tokens[0]}
  urlsarray[$i]=${tokens[1]}
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
    # By default we keep 2000 last log entries. Feel free to modify this to meet your needs.
    echo "$(tail -2000 logs/${key}_report.log)" > "logs/${key}_report.log"
  else
    echo "    $dateTime, $result"
  fi
done

if [ "$commit" = true ]; then
  git config --global user.name 'unclejee'
  git config --global user.email 'swatxhim@outlook.com'
  git add. --force logs/
  git commit -m '[Automated] Update Health Check Logs'
  git push
fi