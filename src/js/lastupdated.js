import { fetchUrlsConfig } from "./fetchurlsconfig.js";
import { reslogs } from "./reslogs.js";

/**
 * 从响应文本中提取最后的更新时间。
 * 
 * 该函数处理一个包含多行文本的响应，其中每行可能包含以逗号分隔的多个值。
 * 它的目的是从这些行中找出最后一行，并从该行中提取出第一个值，这通常表示最后的更新时间。
 * 
 * @param responseText 包含多行文本的响应，每行可能包含以逗号分隔的值。
 * @returns {string} 最后一行的第一个值，即最后的更新时间。
 */
function extractLastUpdateTime(responseText) {
  const lines = responseText.split(/\r\n|\n/).filter(line => line !== "");
  const lastLine = lines.at(-1);
  const lastTime = lastLine.split(",")[0];
  return lastTime;
}

/**
 * 异步函数：获取所有配置的URL列表，并从中提取最新更新时间。
 * @param {Object} useCache - 一个用于控制是否使用缓存的对象，默认为空对象。
 * 异步函数lastupdated解释了其目的：获取并刷新配置的URL列表中最新更新的时间。
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


/**
 * 该函数用于查找页面中具有特定ID的元素，然后将该元素的文本内容更新为给定的更新时间。
 * @param {string} lastUpdateTime - 最后更新时间的字符串表示。
 */
export function refreshLastupdatedon(lastUpdateTime) {
  const updateTimeElement = document.getElementById("updateTime");
  if (updateTimeElement) {
    updateTimeElement.textContent = `Last updated on : ${lastUpdateTime}`;
  }
}