import { reslogs } from './reslogs.js';

export async function getLastDayStatus(urlspath, logspath) {
    const response = await fetch(urlspath);
    const configText = await response.text();
    const configLines = configText.split(/\r\n|\n/).filter(entry => entry!== '').filter(line =>!line.trim().startsWith("#"));
  
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
  
      console.log(`${key} | ${url} 的最后一天状态: ${statusText}`);
    }
  }

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
  