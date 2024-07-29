import { fetchUrlsConfig } from "./fetchurlsconfig.js";
import { reslogs } from "./reslogs.js";


function extractLastUpdateTime(responseText) {
  const lines = responseText.split(/\r\n|\n/).filter(line => line !== "");
  const lastLine = lines.at(-1);
  const lastTime = lastLine.split(",")[0];
  return lastTime;
}

/**
 * 异步函数：获取所有配置的URL列表，并从中提取最新更新时间。
 * @param {Object} useCache - 一个用于控制是否使用缓存的对象，默认为空对象。
 */
export async function lastupdated(useCache = {}) {
  const configLines = await fetchUrlsConfig();
  const urllist = configLines.map(line => line.split("="));

  // 获取所有日志文件的内容
  const promises = urllist.map(([key]) => reslogs(key, useCache));
  const responseTexts = await Promise.all(promises);

  // 提取每个日志文件的最后一行时间
  const lastTimes = responseTexts.map(extractLastUpdateTime);

  // 找到最后更新的时间
  const lastTime = lastTimes.reduce((a, b) => {
    return new Date(a) > new Date(b) ? a : b;
  });

  // 更新页面上的时间
  refreshLastupdatedon(lastTime);
}

export function refreshLastupdatedon(lastUpdateTime) {
  const updateTimeElement = document.getElementById("updateTime");
  if (updateTimeElement) {
    updateTimeElement.textContent = `last updated on : ${lastUpdateTime}`;
  }
}