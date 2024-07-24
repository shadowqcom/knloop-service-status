import { maxDays } from '../index.js';
/**
 * 规范化数据
 * @param {string} statusLines - 状态行字符串
 * @returns {Object} - 规范化后的数据
 */
export function normalizeData(statusLines) {
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
  
  /**
   * 获取日均数据
   * @param {Array} val - 数据数组
   * @returns {any} - 日均数据
   */
  function getDayAverage(val) {
    if (!val || val.length == 0) {
      return null;
    } else {
      return val.reduce((a, v) => a + v) / val.length;
    }
  }
  
  /**
   * 获取相对天数
   * @param {number} dateend - 结束日期
   * @param {number} datestart - 开始日期
   * @returns {number} - 相对天数
   */
  function getRelativeDays(dateend, datestart) {
    return Math.floor(Math.abs((dateend - datestart) / (24 * 3600 * 1000)));
  }
  
  /**
   * 按日期分割行
   * @param {Array} rows - 行数组
   * @returns {Object} - 按日期分割后的数据
   */
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
    const upTime = count? ((sum / count) * 100).toFixed(2) + "%": "--%";
    dateValues.upTime = upTime;
    return dateValues;
  }