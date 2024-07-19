const maxDays = 60;

// 生成报告日志
async function genReportLog(container, key, url) {
  const response = await fetch("logs/" + key + "_report.log");
  let statusLines = "";
  if (response.ok) {
    statusLines = await response.text();
  }

  const normalized = normalizeData(statusLines);
  const statusStream = constructStatusStream(key, url, normalized);
  container.appendChild(statusStream);

  // 创建一个div来包裹span标签
  const divWrapper = document.createElement('div');
  divWrapper.classList.add('span-wrapper'); // 添加一个类以便在CSS中定位这个div

  // 创建并添加两个span标签到divWrapper中
  const spanLeft = document.createElement('span');
  spanLeft.textContent = 'Response times(ms)';
  spanLeft.classList.add('align-left');

  const spanRight = document.createElement('span');
  spanRight.textContent = '占位文本';
  spanRight.classList.add('align-right');

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
  canvas.height = 180;
  container.appendChild(canvas);
  await updateChart(canvas, uptimeData);
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
    tooltip: getTooltip(key, date, color),
  });

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

// 获取状态描述文本
function getStatusDescriptiveText(color) {
  return color == "nodata"
    ? "当前暂无数据。"
    : color == "success"
      ? "状态正常。"
      : color == "failure"
        ? "严重故障。"
        : color == "partial"
          ? "部分异常。"
          : "未知状态";
}

// 获取提示工具文本
function getTooltip(key, date, quartile, color) {
  let statusText = getStatusText(color);
  return `${key} | ${date.toDateString()} : ${quartile} : ${statusText}`;
}

function create(tag, className) {
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
function getRelativeDays(date1, date2) {
  return Math.floor(Math.abs((date1 - date2) / (24 * 3600 * 1000)));
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
      Date.parse(dateTimeStr.replace(/-/g, "/") + " GMT")
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

let tooltipTimeout = null;
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
  const tooltipContent = statusContainer.querySelector(".tooltipContent"); // 获取 tooltipContent 元素
  tooltipContent.querySelector(".tooltipStatus").innerText = formatTiptime + " " + getStatusText(color);
  tooltipContent.style.display = "block"; // 显示提示内容
}

// 隐藏提示
function hideTooltip(element) {
  const statusContainer = element.closest(".statusContainer"); // 找到对应的 statusContainer
  const tooltipContent = statusContainer.querySelector(".tooltipContent"); // 获取 tooltipContent 元素
  tooltipContent.style.display = "none"; // 隐藏提示内容
}

// 生成所有报告
async function genAllReports() {
  const response = await fetch("./src/urls.cfg");
  const configText = await response.text();
  const configLines = configText.split("\n");
  for (let ii = 0; ii < configLines.length; ii++) {
    const configLine = configLines[ii];
    const [key, url] = configLine.split("=");
    if (!key || !url) {
      continue;
    }
    await genReportLog(document.getElementById("reports"), key, url);
  }
}

genAllReports();