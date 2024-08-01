import { reslogs } from "./reslogs.js";
import { updateChart } from "./timelapsechart.js";
import { getColor, constructStatusStream } from "./utils.js";
import { normalizeData } from "./dataProcessing.js";
import { create } from "./domManipulation.js";
import { scrolltoright } from "./scroll.js";
import { fetchUrlsConfig } from "./fetchurlsconfig.js";
import { hideLoadingMask } from "./reloadreports.js";

/**
 * 异步函数：根据 urls.cfg 文件，生成所有报告。
 * @param {string} urlspath - 配置文件的路径，其中包含需要生成报告的URL列表。
 */
export async function genAllReports(useCache = {}) {
  try {
    const configLines = await fetchUrlsConfig();
    for (let ii = 0; ii < configLines.length; ii++) {
      const configLine = configLines[ii];
      const [key, url] = configLine.split("=");
      await genReportLog(document.getElementById("reports"), key, url, useCache);
    }

  } catch (error) {
    console.error("Error genAllReports :", error);
  }

  hideLoadingMask(); // 隐藏loading-mask
  scrolltoright();  // 滚动到最右侧
}


/**
 * 异步生成报告日志。
 * @param {HTMLElement} container - 用于装载报告日志的容器元素。
 * @param {string} key - 报告日志的唯一标识键。
 * @param {string} url - 相关 URL，用于报告中显示。
 * @param {string} logspath - 日志文件的路径。
 */
async function genReportLog(container, key, url, useCache = {}) {
  let statusLines = await reslogs(key, useCache);

  const normalized = normalizeData(statusLines);
  const statusStream = constructStatusStream(key, url, normalized);
  container.appendChild(statusStream);
  // 创建一个 div 来包裹 span 标签
  const divWrapper = create("div");
  divWrapper.classList.add("span-wrapper"); // 添加一个类以便在 CSS 中定位这个 div
  divWrapper.id = "status-prompt"; // 设置 div 的 ID
  // 创建并添加两个 span 标签到 divWrapper 中
  const spanLeft = create("span", "span-title");
  spanLeft.textContent = "响应时间(ms)";
  spanLeft.classList.add("align-left");
  const spanRight = create("span", "span-text");
  spanRight.classList.add("align-right");
  divWrapper.appendChild(spanLeft);
  divWrapper.appendChild(spanRight);
  // 将包含两个 span 的 div 添加到 container 中
  container.appendChild(divWrapper);
  const canvas = create("canvas", "chart");
  canvas.id = "chart_clone_" + key++;
  container.appendChild(canvas);
  updateChart(canvas, statusLines);
}


// 所有服务当天整体状态评估
export async function getLastDayStatus(useCache = {}) {
  const configLines = await fetchUrlsConfig();
  const statusTexts = []; // 存储 statusText 的数组
  for (let ii = 0; ii < configLines.length; ii++) {
    const configLine = configLines[ii];
    const [key] = configLine.split("=");

    // 根据条件确定是否使用缓存
    let statusLines = await reslogs(key, useCache);

    const normalized = normalizeData(statusLines);
    // 获取最后一天的状态
    const lastDayStatus = normalized[0];
    const statusText = getColor(lastDayStatus); // nodata success failure
    statusTexts.push(statusText); // 将 statusText 存入数组。
  }

  let successCount = 0, failureCount = 0, nodataCount = 0;

  for (const item of statusTexts) {
    if (item === 'success') {
      successCount++;
    } else if (item === 'failure') {
      failureCount++;
    } else if (item === 'nodata') {
      nodataCount++;
    }
  }

  const totalCount = statusTexts.length; // 总服务数
  const failureThreshold = totalCount * 0.2; // 有效服务 Down 20% 即整体报告为Down
  const nodateThreshold = totalCount * 0.5; // 有效服务 No Data 50% 即整体报告为No Data

  const conditions = [
    { condition: successCount === totalCount, src: './public/check/success.svg', alt: 'UP' },
    { condition: nodataCount === totalCount, src: './public/check/nodata.svg', alt: 'No data' },
    { condition: failureCount >= failureThreshold || nodataCount >= nodateThreshold, src: './public/check/failure.svg', alt: 'Down' },
    { condition: true, src: './public/check/partial.svg', alt: 'Degraded' }
  ];

  const img = document.querySelector("#statusImg");

  for (const { condition, src, alt } of conditions) {
    if (condition) {
      img.src = src;
      img.alt = alt;
      img.classList.remove('icobeat');
      break;
    }
  }
}
