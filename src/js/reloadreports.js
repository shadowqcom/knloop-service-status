import { reloadReportsdata } from "../index.js";
import { reslogs } from "./reslogs.js";
import {fetchUrlsConfig} from "./fetchurlsconfig.js";
import { genAllReports } from "./genReports.js";
import { lastupdated } from "./lastupdated.js";
import { getLastDayStatus } from "./lastdaystatus.js";


async function checkAndReloadReports() {
  const useCache = false;
  const logsetag = await getlogsetag({}, useCache);
  let etag = logsetag[1]; // 初次获取ETag 设置为初始值。

  const interval = 0.1 * 60 * 1000; // 分钟转换为毫秒

  // 使用setInterval来周期性地执行
  setInterval(async function () {
    try {
      const headers = { 'If-None-Match' : etag };
      const response = await getlogsetag(headers, useCache);
      etag = response[1];
      const resstatus = response[2];
      console.log(resstatus);
      if (resstatus !== 304) {
        showLoadingMask(); // 显示加载遮罩
        clearReports(); // 清理旧的报告
        await genAllReports(); // 生成新的报告
        hideLoadingMask(); // 隐藏加载遮罩
        await lastupdated();
        await getLastDayStatus();
        startTime = lastuptime;
        console.log("日志数据已更新");
      }
    } catch (error) {
      console.error("重载日志数据失败:", error);
    }
  }, interval);
}

// 获取logs请求头中的ETag，方便后续判断是否有更新
async function getlogsetag(headers, useCache) {
  const configLines = await fetchUrlsConfig();
  const [key] = configLines[0].split("=");
  const response = await reslogs(key, headers, useCache);
  return response;
}

// 清理旧的报告
function clearReports() {
  const reportsElement = document.getElementById("reports");
  while (reportsElement.firstChild) {
    reportsElement.removeChild(reportsElement.firstChild);
  }
}

// 显示加载遮罩
function showLoadingMask() {
  document.getElementById("loading-mask").classList.remove("hidden");
}
// 隐藏加载遮罩
function hideLoadingMask() {
  document.getElementById("loading-mask").classList.add("hidden");
}

export async function reloadReports() {
  if (reloadReportsdata) {
    await checkAndReloadReports();
  }
}
