#!/bin/bash

export TZ='Asia/Shanghai'

KEYSARRAY=()
URLSARRAY=()

# 读取urls.cfg配置文件
urlsConfig="./src/urls.cfg"
while read -r line; do
    if [[ ${line} =~ ^\s*# ]] ; then
        continue
    fi
    echo "[$line] 正在检测中······"
    IFS='=' read -ra TOKENS <<<"$line"
    KEYSARRAY+=(${TOKENS[0]})
    URLSARRAY+=(${TOKENS[1]})
done <"$urlsConfig"

# 创建需要的文件夹
mkdir -p ./logs
mkdir -p ./tmp

# 创建一个数组来保存所有子shell的PID
pids=()

# 对于每一个URL，启动一个子shell来执行检测
for ((index = 0; index < ${#KEYSARRAY[@]}; index++)); do
  key="${KEYSARRAY[index]}"
  url="${URLSARRAY[index]}"

  # 在子shell中执行检测
  (
    for i in 1 2 3; do
      response=$(curl --write-out '%{http_code}' --silent --output /dev/null --max-time 7 "$url")
      if [[ "$response" =~ ^(200|201|202|301|302|307)$ ]]; then
        result="success"
        break
      fi
      result="failed"
      sleep 5
    done

    # 成功的url使用ping测试延迟。
    if [[ $result == "success" ]]; then
      # 通过curl测试连接耗时
      connect_time_seconds=$(curl -o /dev/null -s -w "%{time_connect}\n" "$url")
      connect_time_ms=$(awk '{printf "%.0f\n", ($1 * 1000 + 0.5)}' <<<"$connect_time_seconds")
    fi

    # 日志数据写入log文件
    dateTime=$(date +'%Y-%m-%d %H:%M')
    echo "$dateTime, $result, ${connect_time_ms:-null}" >> "./logs/${key}_report.log"
    # 保留30000条数据
    echo "$(tail -30000 ./logs/${key}_report.log)" > "./logs/${key}_report.log"
  ) &
  pids+=($!)
done

# 等待所有子shell完成
for pid in "${pids[@]}"; do
  wait $pid
done

# 读取webhook.cfg配置，用一个数组webhookconfig存储配置项
declare -A webhookconfig
while IFS='=' read -r key value; do
  # 移除键和值两侧的空白字符
  key=$(echo "$key" | xargs)
  value=$(echo "$value" | xargs)
  # 存储键值对
  webhookconfig["$key"]="$value"
done <./src/webhook.cfg


# 如果./tmp/failed_urls.log不存在
if [ ! -f "./tmp/failed_urls.log" ]; then
  echo "没有失败的url"
  exit 0
fi

# 构建Markdown消息
failedUrlsMessage=""
while IFS= read -r line; do
  if [ -n "$failedUrlsMessage" ]; then
    failedUrlsMessage+="\n"
  fi
  failedUrlsMessage+="$line"
done <./tmp/failed_urls.log

# 检查是否开启推送，如果开启了推送并且有失败的url 则推送企业微信
if [[ "${webhookconfig["push"]}" == "true" ]] && [ -n "$failedUrlsMessage" ]; then
  echo "**********************************************"
  echo "检测完成，开始推送企业微信"
  MessageTime=$(date +'%Y-%m-%d %H:%M')
  curl "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=$WEBHOOK_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
          "msgtype": "markdown",
          "markdown": {
            "content": "### Service Down\n > '"$MessageTime"'\n > 以下 url/api 请求失败:\n\n'"$failedUrlsMessage"'"
          }
      }'
fi