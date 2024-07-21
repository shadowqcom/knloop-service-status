// 获取最后更新时间
async function lastUpdatedtime() {
  const configResponse = await fetch("./src/urls.cfg");
  const configText = await configResponse.text();
  const configLines = configText.split(/\r\n|\n/).filter(entry => entry !== '').filter(line => !line.trim().startsWith("#"))
  const urllist = configLines.map(line => line.split("="));
  // console.log(urllist);

  // 定义一个数组存储每次循环得到的值
  const lastlinetime = [];

  // 循环urllist每个值的第一个key,通过key取每个log文件的最后一个有效值。
  for (let i = 0; i < urllist.length; i++) {
    const key = urllist[i][0];
    const response = await fetch("logs/" + key + "_report.log");
    let statusLines = "";
    if (response.ok) {
      statusLines = await response.text();
    }
    const lines = statusLines.split(/\r\n|\n/).filter(entry => entry !== '');
    const lastTime = lines[lines.length - 1].split(",")[0];
    lastlinetime.push(lastTime);
  }

  console.log(lastlinetime);

  // 计算出lastlinetime中最新的时间
  const lastTime = lastlinetime.reduce((a, b) => {
    return new Date(a) > new Date(b) ? a : b;
  });

  // 在这里调用 updateLastUpdated 函数并传递 lastTime
  updateLastUpdated(lastTime);
}

// 将最后更新时间写到页面
function updateLastUpdated(lastUpdateTime) {
  const updateTimeElement = document.getElementById("updateTime");
  if (updateTimeElement) {
    updateTimeElement.textContent = `Last updated on : ${lastUpdateTime}`;
  }
}

// 当 DOM 加载完成后调用 lastUpdatedtime 函数
document.addEventListener("DOMContentLoaded", function () {
  lastUpdatedtime();
});