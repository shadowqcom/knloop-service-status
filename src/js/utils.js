import { templatize } from './domManipulation.js';
import { showTooltip, hideTooltip } from './tooltip.js';
import { maxDays } from '../index.js';
/**
 * 获取颜色
 * @param {any} uptimeVal - 运行时间值
 * @returns {string} - 颜色字符串
 */
export function getColor(uptimeVal) {
    return uptimeVal == null
    ? "nodata"
     : uptimeVal == 1
     ? "success"
      : uptimeVal < 0.3
      ? "failure"
       : "partial";
  }
  
  /**
   * 获取状态文本
   * @param {string} color - 颜色
   * @returns {string} - 状态文本
   */
  export function getStatusText(color) {
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
  
  /**
   * 构建状态流
   * @param {string} key - 键
   * @param {string} url - URL
   * @param {Object} uptimeData - 运行时间数据
   * @returns {HTMLElement} - 状态流容器元素
   */
  export function constructStatusStream(key, url, uptimeData) {
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
  
  /**
   * 构建状态行
   * @param {string} key - 键
   * @param {number} relDay - 相对天数
   * @param {any} upTimeArray - 运行时间数组
   * @returns {HTMLElement} - 状态行元素
   */
  function constructStatusLine(key, relDay, upTimeArray) {
    let date = new Date();
    date.setDate(date.getDate() - relDay);
    return constructStatusSquare(key, date, upTimeArray);
  }


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