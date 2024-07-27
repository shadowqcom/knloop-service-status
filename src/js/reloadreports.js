import { reloadReportsdata, reloadReportstime } from "../index.js";
import { reslogs } from "./reslogs.js";
import { fetchUrlsConfig } from "./fetchurlsconfig.js";
import { genAllReports, getLastDayStatus } from "./genReports.js";
import { refreshLastupdatedon } from "./lastupdated.js";

const useCache = { cache: 'reload' };  // 不使用缓存
let startTime;
async function checkAndReloadReports() {
  startTime = await getlastTime(); // 初始化全局变量
  const interval = reloadReportstime * 60 * 1000; // 分钟转换为毫秒

  // 使用setInterval来周期性地执行
  setInterval(async function () {
    try {
      const lastTime = await getlastTime();
      if (startTime >= lastTime) {
        return; // 如果时间没有变化，则跳过此次循环
      }

      // 数据有更新则重新加载日志数据
      showLoadingMask(); // 显示加载动画
      clearReports(); // 清理旧的报告
      await genAllReports(useCache); // 生成新的报告
      await getLastDayStatus(useCache);
      refreshLastupdatedon(lastTime);  // 刷新 Last updated on
      hideLoadingMask(); // 隐藏加载动画

      startTime = lastTime;  // 重置开始时间

    } catch (error) {
      console.error("重载日志数据失败:", error);
    }
  }, interval);
}

// 获取随机一个服务的最后一行时间
async function getlastTime() {
  const configLines = await fetchUrlsConfig();

  const randomIndex = Math.floor(Math.random() * configLines.length);    // 从配置行中随机选择一行
  const randomLine = configLines[randomIndex];

  const [key] = randomLine.split("=");
  const response = await reslogs(key, useCache);
  const lastlines = response.split(/\r\n|\n/).filter((entry) => entry !== "");
  const lastTime = lastlines.at(-1).split(",")[0];
  return lastTime;
}

// 清理旧的报告
function clearReports() {
  const reportsElement = document.getElementById("reports");
  while (reportsElement.firstChild) {
    reportsElement.removeChild(reportsElement.firstChild);
  }
  const img = document.querySelector("#statusImg");
  img.src = "./public/check/nodata.svg";
  img.alt = "No Data";

  refreshLastupdatedon("Loading..."); // 刷新 Last updated on

}


// 显示加载动画
export function showLoadingMask() {
  document.getElementById("loading-mask").classList.remove("hidden");
}
// 隐藏加载动画
export function hideLoadingMask() {
  document.getElementById("loading-mask").classList.add("hidden");
}

export async function reloadReports() {
  if (reloadReportsdata) {
    await checkAndReloadReports();
  }
}
