import { fetchUrlsConfig } from "./fetchurlsconfig.js";
import { reslogs } from "./reslogs.js";

/**
 * 异步函数：获取最新更新时间
 * 该函数通过读取配置文件中的URL列表，来确定哪些资源是最新的。
 * 它首先从配置文件中读取URL列表，然后过滤掉空白行和注释行。
 * 最后，它准备一个列表，包含每个URL及其对应的最新更新时间。
 */
export async function lastUpdatedtime(useCache = true) {
  const configLines = await fetchUrlsConfig();
  const urllist = configLines.map((line) => line.split("="));

  // 定义一个数组存储每次循环得到的值
  const lastlinetime = [];

  // 循环urllist每个值的第一个key,通过key取每个log文件的最后一个有效值。
  for (let i = 0; i < urllist.length; i++) {
    const key = urllist[i][0];
    const responseText = await reslogs(key, useCache);
    let statusLines = responseText;
    const lines = statusLines.split(/\r\n|\n/).filter((entry) => entry !== "");
    const lastTime = lines[lines.length - 1].split(",")[0];
    lastlinetime.push(lastTime);
  }

  // 计算出lastlinetime中最新的时间
  const lastTime = lastlinetime.reduce((a, b) => {
    return new Date(a) > new Date(b) ? a : b;
  });

  // 在这里调用 updateLastUpdated 函数并传递 lastTime
  updateLastUpdated(lastTime);
  return lastTime;
}

// 将最后更新时间写到页面
function updateLastUpdated(lastUpdateTime) {
  const updateTimeElement = document.getElementById("updateTime");
  if (updateTimeElement) {
    updateTimeElement.textContent = `Last updated on : ${lastUpdateTime}`;
  }
}

// DOM加载完成后再执行
export async function lastupdated(useCache = true) {
  try {
    document.addEventListener("DOMContentLoaded", function () {
      lastUpdatedtime(useCache); // 显示最新更新时间
    });
  } catch (error) {
    console.error("获取最新更新时间失败:", error);
  }
}
