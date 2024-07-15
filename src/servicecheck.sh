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

mkdir -p logs

# 创建一个数组来保存所有子shell的PID
pids=()

# 对于每一个URL，启动一个子shell来执行检测
for (( index=0; index < ${#KEYSARRAY[@]}; index++))
do
  key="${KEYSARRAY[index]}"
  url="${URLSARRAY[index]}"
  
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
    
    dateTime=$(date +'%Y-%m-%d %H:%M')
    if [[ $commit == true ]]
    then
      echo $dateTime, $result >> "./logs/${key}_report.log"
      # 保留2000条数据
      echo "$(tail -2000 ./logs/${key}_report.log)" > "./logs/${key}_report.log"
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
echo "检测完成，开始提交log文件"

if [[ $commit == true ]]
then
  # 提交到仓库
  git config --global user.name 'unclejee'
  git config --global user.email 'swatxhim@outlook.com'
  git add -A --force logs/
  git commit -am '[Automated] Update Health Check Logs'
  git push
fi