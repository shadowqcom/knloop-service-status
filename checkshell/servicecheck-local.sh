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
mkdir -p ./logs/
mkdir -p ./tmp/
mkdir -p ./tmp/logs/

# 创建一个数组来保存所有子shell的PID
pids=()

# 对于每一个URL，启动一个子shell来执行检测。
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

    # 获取当前时间
    dateTime=$(date +'%Y-%m-%d %H:%M')

    # 失败的url写入临时文件,成功的url使用ping测试延迟
    if [[ $result == "failed" ]]; then
      touch ./tmp/failed_urls.lock
      touch ./tmp/failed_urls.log
      exec 9>"./tmp/failed_urls.lock"
      flock -x 9
      if ! grep -qFx "$url" ./tmp/failed_urls.log; then
        echo "$dateTime, $url" >>./tmp/failed_urls.log
      fi
      exec 9>&-
    else
      # 测试连接耗时
      connect_time_seconds=$(curl -o /dev/null -s -w "%{time_connect}\n" "$url")
      connect_time_ms=$(awk '{printf "%.0f\n", ($1 * 1000 + 0.5)}' <<<"$connect_time_seconds")
    fi

    # 日志数据写入log文件
    
    echo "$dateTime, $result, ${connect_time_ms:-null}" >>"./tmp/logs/${key}_report.log"
    # 保留1000条数据
    echo "$(tail -1000 ./tmp/logs/${key}_report.log)" >"./tmp/logs/${key}_report.log"
  ) &
  pids+=($!)
done

# 等待所有子shell完成
for pid in "${pids[@]}"; do
  wait $pid
done
rm -f ./tmp/failed_urls.lock