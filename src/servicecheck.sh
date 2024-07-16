commit=true
origin=$(git remote get-url origin)
if [[ $origin == *statsig-io/statuspage* ]]
then
  commit=false
fi

KEYSARRAY=()
URLSARRAY=()

echo "**********************************************"
urlsConfig="./src/urls.cfg"
echo "读取urls配置文件 $urlsConfig"
while read -r line
do
  echo "$line"
  IFS='=' read -ra TOKENS <<< "$line"
  KEYSARRAY+=(${TOKENS[0]})
  URLSARRAY+=(${TOKENS[1]})
done < "$urlsConfig"

echo "**********************************************"
echo "开始执行 ${#KEYSARRAY[@]} 个检测任务:"

mkdir -p ./logs

# 创建一个数组来保存所有子shell的PID
pids=()

# 对于每一个URL，启动一个子shell来执行检测
for (( index=0; index < ${#KEYSARRAY[@]}; index++))
do
  key="${KEYSARRAY[index]}"
  url="${URLSARRAY[index]}"
  
  # 定义一个数组来存储三次都失败的URLs
  failedUrls=()

  # 在子shell中执行检测
  (
    echo "[$key] 正在检测中······"
    
  for i in 1 2 3; 
  do
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

    # 添加失败的URL到数组
    if [ "$result" = "failed" ]; then
      failedUrls+=("$url") 
    fi
    
    dateTime=$(date +'%Y-%m-%d %H:%M')
    if [[ $commit == true ]]
    then
      echo $dateTime, $result >> "./logs/${key}_report.log"
      # 保留5000条数据
      echo "$(tail -5000 ./logs/${key}_report.log)" > "./logs/${key}_report.log"
    else
      echo "$dateTime, $result"
    fi
  ) &
  pids+=($!)
done

# 等待所有子shell完成
for pid in "${pids[@]}"
do
  wait $pid
done

echo "**********************************************"
echo "检测完成，开始推送企业微信"

failedUrlsMessage=()
# 遍历failedUrls数组，将每个URL添加到消息中
for url in "${failedUrls[@]}"; do
  failedUrlsMessage+="\n- $url"
done

# 使用curl发送消息
if [ -n "$failedUrlsMessage" ]; then
   curl "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=$WEBHOOK_KEY" \
   -H 'Content-Type: application/json' \
   -d '{
          "msgtype": "markdown",
          "markdown": {
            "content": "#### 服务健康检查失败通知\n > 以下URL未通过健康检查：\n  '$failedUrlsMessage'"
          }
      }'
fi

echo "**********************************************"
echo "开始提交.log文件到仓库"

if [[ $commit == true ]]
then
  # 提交到仓库
  git config --global user.name 'Github Actions'
  git config --global user.email 'Actions@knloop.com'
  git add -A --force ./logs/
  git commit -am '[Automated] Update Service Check Logs'
  git push
fi