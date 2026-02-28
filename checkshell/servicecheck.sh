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
    # 保留50000条数据
    echo "$(tail -50000 ./logs/${key}_report.log)" > "./logs/${key}_report.log"
  ) &
  pids+=($!)
done

# 等待所有子shell完成
for pid in "${pids[@]}"; do
  wait $pid
done