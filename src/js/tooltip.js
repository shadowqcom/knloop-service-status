import { getStatusText } from './utils.js';


/**
 * 显示提示
 * @param {HTMLElement} element - 元素
 * @param {Date} date - 日期
 * @param {string} color - 颜色
 */
export function showTooltip(element, date, color) {
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
  
  /**
   * 隐藏提示
   * @param {HTMLElement} element - 元素
   */
  export function hideTooltip(element) {
    const statusContainer = element.closest(".statusContainer"); // 找到对应的 statusContainer
    if (!statusContainer) return;
    const nextElement = statusContainer.nextElementSibling;
    const tooltipContent = nextElement.querySelector(".span-text"); // 获取 tooltipContent 元素
    tooltipContent.style.display = "none"; // 隐藏提示内容
  }