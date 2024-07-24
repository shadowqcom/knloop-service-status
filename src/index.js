import { lastupdated } from './lastupdated.js';
import { reslogs } from './reslogs.js';
import { getclieninfo } from './getclieninfo.js';
import { scrolltoright } from './scrolltoright.js';
import { updateChart } from './timelapsechart.js';

/**
 * maxDays 建议设置在30到90之间，否则页面无法自适应。
 * urlspath 是设置监控的URL列表。
 */
// ***********************************
const maxDays = 60;
const urlspath = "./src/urls.cfg";
// const logspath = "./logs/";
const logspath = "//raw.github.knloop.com/shadowqcom/knloop-service-status/main/logs/";
// ***********************************

/**
 * 异步函数：根据urls.cfg文件，生成所有报告
 * @param {string} urlspath - 配置文件的路径，其中包含需要生成报告的URL列表。
 */
async function genAllReports(urlspath) {
  const response = await fetch(urlspath);
  const configText = await response.text();
  const configLines = configText.split(/\r\n|\n/).filter(entry => entry !== '').filter(line => !line.trim().startsWith("#"));
  for (let ii = 0; ii < configLines.length; ii++) {
    const configLine = configLines[ii];
    const [key, url] = configLine.split("=");
    await genReportLog(document.getElementById("reports"), key, url, logspath);
  }
  scrolltoright();   // 执行滚动状态条
}
/**
 * 异步生成报告日志。
 * @param {HTMLElement} container - 用于装载报告日志的容器元素。
 * @param {string} key - 报告日志的唯一标识键。
 * @param {string} url - 相关URL，用于报告中显示。
 * @param {string} logspath - 日志文件的路径。
 */
async function genReportLog(container, key, url, logspath) {
  const response = await reslogs(logspath, key);
  let statusLines = "";
  if (response.ok) {
    statusLines = await response.text();
  }

  const normalized = normalizeData(statusLines);
  const statusStream = constructStatusStream(key, url, normalized);
  container.appendChild(statusStream);

  // 创建一个div来包裹span标签
  const divWrapper = create("div");
  divWrapper.classList.add("span-wrapper"); // 添加一个类以便在CSS中定位这个div
  divWrapper.id = "status-prompt"; // 设置div的ID

  // 创建并添加两个span标签到divWrapper中
  const spanLeft = create("span", "span-title");
  spanLeft.textContent = "响应时间(ms)";
  spanLeft.classList.add("align-left");

  const spanRight = create("span", "span-text");
  spanRight.classList.add("align-right");

  divWrapper.appendChild(spanLeft);
  divWrapper.appendChild(spanRight);

  // 将包含两个span的div添加到container中
  container.appendChild(divWrapper);

  // 生成图表
  createChart(container, key, statusLines);
}

// 生成图表
async function createChart(container, key, uptimeData) {
  const canvas = create("canvas", "chart");
  canvas.id = "chart_clone_" + key++;
  container.appendChild(canvas);
  updateChart(canvas, uptimeData);
}

// 构建状态流
function constructStatusStream(key, url, uptimeData) {
  let streamContainer = templatize("statusStreamContainerTemplate");
  for (var ii = maxDays - 1; ii >= 0; ii--) {
    let line = constructStatusLine(key, ii, uptimeData[ii]);
    streamContainer.appendChild(line);
  }

  const lastSet = uptimeData[0];
  const color = getColor(lastSet);

  const container = templatize("statusContainerTemplate", {
    title: key,
    url: url,
    domainname: url.replace(/^(http:\/\/|https:\/\/)/, ""),
    color: color,
    status: getStatusText(color),
    upTime: uptimeData.upTime,
  });

  container.appendChild(streamContainer);
  return container;
}

// 构建状态行
function constructStatusLine(key, relDay, upTimeArray) {
  let date = new Date();
  date.setDate(date.getDate() - relDay);

  return constructStatusSquare(key, date, upTimeArray);
}

// 获取颜色
function getColor(uptimeVal) {
  return uptimeVal == null
    ? "nodata"
    : uptimeVal == 1
      ? "success"
      : uptimeVal < 0.3
        ? "failure"
        : "partial";
}

// 构建状态方块
function constructStatusSquare(key, date, uptimeVal) {
  const color = getColor(uptimeVal);
  let square = templatize("statusSquareTemplate", {
    color: color,
  });

  // const kk = getTooltip(key, date, color)
  // console.log(kk)

  const show = () => {
    showTooltip(square, date, color);
  };
  const hide = () => {
    hideTooltip(square);
  };

  square.addEventListener("mouseover", show);
  square.addEventListener("mousedown", show);
  square.addEventListener("mouseout", hide);

  return square;
}

// 模板化
let cloneId = 0;
function templatize(templateId, parameters) {
  let clone = document.getElementById(templateId).cloneNode(true);
  clone.id = "template_clone_" + cloneId++;
  if (!parameters) {
    return clone;
  }

  applyTemplateSubstitutions(clone, parameters);
  return clone;
}

// 应用模板替换
function applyTemplateSubstitutions(node, parameters) {
  const attributes = node.getAttributeNames();
  for (var ii = 0; ii < attributes.length; ii++) {
    const attr = attributes[ii];
    const attrVal = node.getAttribute(attr);
    node.setAttribute(attr, templatizeString(attrVal, parameters));
  }

  if (node.childElementCount == 0) {
    node.innerText = templatizeString(node.innerText, parameters);
  } else {
    const children = Array.from(node.children);
    children.forEach((n) => {
      applyTemplateSubstitutions(n, parameters);
    });
  }
}

// 模板字符串化
function templatizeString(text, parameters) {
  if (parameters) {
    for (const [key, val] of Object.entries(parameters)) {
      text = text.replaceAll("$" + key, val);
    }
  }
  return text;
}

// 获取状态文本
function getStatusText(color) {
  return color == "nodata"
    ? "No Data"
    : color == "success"
      ? "UP"
      : color == "failure"
        ? "Down"
        : color == "partial"
          ? "Degraded"
          : "Unknown";
}

// 获取提示工具文本
function getTooltip(key, date, color) {
  let statusText = getStatusText(color);
  return `${key} | ${date.toDateString()} : ${statusText}`;
}

// 创建一个指定标签的元素.
function create(tag, className = "") {
  let element = document.createElement(tag);
  element.className = className;
  return element;
}

// 规范化数据
function normalizeData(statusLines) {
  const rows = statusLines.split("\n");
  const dateNormalized = splitRowsByDate(rows);

  let relativeDateMap = {};
  const now = Date.now();
  for (const [key, val] of Object.entries(dateNormalized)) {
    if (key == "upTime") {
      continue;
    }

    const relDays = getRelativeDays(now, new Date(key).getTime());
    relativeDateMap[relDays] = getDayAverage(val);
  }

  relativeDateMap.upTime = dateNormalized.upTime;
  return relativeDateMap;
}

// 获取日均数据
function getDayAverage(val) {
  if (!val || val.length == 0) {
    return null;
  } else {
    return val.reduce((a, v) => a + v) / val.length;
  }
}

// 获取相对天数
function getRelativeDays(dateend, datestart) {
  return Math.floor(Math.abs((dateend - datestart) / (24 * 3600 * 1000)));
}

// 按日期分割行
function splitRowsByDate(rows) {
  let dateValues = {};
  let sum = 0,
    count = 0;
  for (var ii = 0; ii < rows.length; ii++) {
    const row = rows[ii];
    if (!row) {
      continue;
    }

    const [dateTimeStr, resultStr] = row.split(",", 2);
    const dateTime = new Date(
      Date.parse(dateTimeStr.replace(/-/g, "/"))
    );
    const dateStr = dateTime.toDateString();

    let resultArray = dateValues[dateStr];
    if (!resultArray) {
      resultArray = [];
      dateValues[dateStr] = resultArray;
      if (dateValues.length > maxDays) {
        break;
      }
    }

    let result = 0;
    if (resultStr.trim() == "success") {
      result = 1;
    }
    sum += result;
    count++;

    resultArray.push(result);
  }

  const upTime = count ? ((sum / count) * 100).toFixed(2) + "%" : "--%";
  dateValues.upTime = upTime;
  return dateValues;
}

// 显示提示
function showTooltip(element, date, color) {
  const toolTiptime = new Date(date);
  // 提取星期、年、月和日
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    toolTiptime.getDay()
  ];
  const year = toolTiptime.getFullYear();
  const month = ("0" + (toolTiptime.getMonth() + 1)).slice(-2);
  const day = ("0" + toolTiptime.getDate()).slice(-2);
  // 拼接成所需格式
  const formatTiptime = `${weekday} ${year}-${month}-${day}`;

  const statusContainer = element.closest(".statusContainer"); // 找到对应的 statusContainer
  if (!statusContainer) return;
  const nextElement = statusContainer.nextElementSibling;
  const tooltipContent = nextElement.querySelector(".span-text"); // 获取 tooltipContent 元素
  tooltipContent.innerText = formatTiptime + " " + getStatusText(color);
  tooltipContent.style.display = "block"; // 显示提示内容
}

// 隐藏提示
function hideTooltip(element) {
  const statusContainer = element.closest(".statusContainer"); // 找到对应的 statusContainer
  if (!statusContainer) return;
  const nextElement = statusContainer.nextElementSibling;
  const tooltipContent = nextElement.querySelector(".span-text"); // 获取 tooltipContent 元素
  tooltipContent.style.display = "none"; // 隐藏提示内容
}

// 所有服务当天整体状态评估
async function getLastDayStatus(urlspath) {
  const response = await fetch(urlspath);
  const configText = await response.text();
  const configLines = configText.split(/\r\n|\n/).filter(entry => entry !== '').filter(line => !line.trim().startsWith("#"));

  const statusTexts = []; // 存储 statusText 的数组

  for (let ii = 0; ii < configLines.length; ii++) {
    const configLine = configLines[ii];
    const [key, url] = configLine.split("=");

    const response = await reslogs(logspath, key);
    let statusLines = "";
    if (response.ok) {
      statusLines = await response.text();
    }
    const normalized = normalizeData(statusLines);

    // 获取最后一天的状态
    const lastDayStatus = normalized[0];
    const color = getColor(lastDayStatus);
    const statusText = getStatusText(color);

    statusTexts.push(statusText); // 将 statusText 存入数组
  }

  const upCount = statusTexts.filter(text => text === 'UP').length;
  const downCount = statusTexts.filter(text => text === 'Down').length;
  const nodateCount = statusTexts.filter(text => text === 'No Data').length;

  const img = document.querySelector('#statusImg');

  const totalCount = statusTexts.length;
  const downThreshold = totalCount * 0.2;
  const nodateThreshold = totalCount * 0.5;

  if (upCount === totalCount) {
    img.src = './public/check/up.svg';
    img.alt = 'UP';
  } else if (nodateCount === totalCount) {
    img.src = './public/check/nodata.svg';
    img.alt = 'No Data';
  } else if (downCount >= downThreshold || nodateCount >= nodateThreshold) {
    img.src = './public/check/down.svg';
    img.alt = 'Down';
  } else {
    img.src = './public/check/degraded.svg';
    img.alt = 'Degraded';
  }
}

// 更新页脚年份
function getyear() {
  var currentYearElement = document.getElementById("currentYear");
  currentYearElement.textContent = new Date().getFullYear(); // 更新为当前年份
}

// 主函数入口
async function main(urlspath, logspath) {
  genAllReports(urlspath); // 生成所有报告完成
  lastupdated(urlspath, logspath); // 显示最新更新时间
  getclieninfo(); // 获取客户端信息
  getyear(); // 更新页脚年份
  getLastDayStatus(urlspath); // 当天整体状态
}

main(urlspath, logspath);
