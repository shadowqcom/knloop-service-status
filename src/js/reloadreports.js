import { lastUpdatedtime, lastupdated } from "./lastupdated.js";
import { genAllReports } from "./genReports.js";
import { getLastDayStatus } from "./genReports.js";
import { reloadReportsdata } from "../index.js";

async function checkAndReloadReports() {
  const interval = 0.1 * 60 * 1000; // 分钟转换为毫秒
  let startTime = await lastUpdatedtime();

  // 使用setInterval来周期性地执行
  setInterval(async function () {
    try {
      const useCache = false;
      const lastuptime = await lastUpdatedtime(useCache);
      if (startTime < lastuptime) {
        showLoadingMask(); // 显示加载遮罩
        clearReports(); // 清理旧的报告
        await genAllReports(); // 生成新的报告
        hideLoadingMask(); // 隐藏加载遮罩
        await lastupdated(useCache);
        await getLastDayStatus(useCache);
        startTime = lastuptime;
      }
    } catch (error) {
      console.error("重载日志数据失败:", error);
    }
  }, interval);
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
