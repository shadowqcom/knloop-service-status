import { getConfig, onConfigLoaded } from './configLoader.js';
import { parseBeijingTime, formatDate } from './utils.js';

let maxDays = getConfig().maxDays;

onConfigLoaded(config => {
  maxDays = config.maxDays;
});

export function calculateServiceStats(logText) {
  const lines = logText.split(/\r\n|\n/).filter(line => line.trim());
  const now = new Date();
  
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  
  let todayFailures = 0;
  let lastFailureTime = null;
  let maxConsecutiveDays = 0;
  let currentConsecutiveDays = 0;
  
  const dailyStatus = new Map();
  
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      const timeStr = data.time || data.timestamp;
      const logDate = parseBeijingTime(timeStr);
      
      if (!logDate) continue;
      
      const dateStr = logDate.toDateString();
      
      if (!dailyStatus.has(dateStr)) {
        dailyStatus.set(dateStr, { success: 0, failed: 0, total: 0 });
      }
      
      const dayData = dailyStatus.get(dateStr);
      dayData.total++;
      
      if (data.status === 'success') {
        dayData.success++;
      } else {
        dayData.failed++;
        
        if (logDate >= todayStart) {
          todayFailures++;
        }
        
        if (!lastFailureTime || logDate > parseBeijingTime(lastFailureTime)) {
          lastFailureTime = timeStr;
        }
      }
    } catch (e) {
      console.debug('[calculateServiceStats] Parse error:', e.message);
    }
  }
  
  const sortedDates = Array.from(dailyStatus.keys()).sort((a, b) => 
    new Date(b) - new Date(a)
  );
  
  for (const dateStr of sortedDates) {
    const dayData = dailyStatus.get(dateStr);
    if (dayData.failed === 0 && dayData.total > 0) {
      currentConsecutiveDays++;
    } else {
      break;
    }
  }
  maxConsecutiveDays = currentConsecutiveDays;
  
  return {
    todayFailures,
    lastFailureTime: lastFailureTime ? formatDate(parseBeijingTime(lastFailureTime), 'full') : null,
    maxConsecutiveDays
  };
}

export function calculateGlobalStats(services) {
  let totalTodayFailures = 0;
  let totalConsecutiveDays = 0;
  let servicesWithFailures = 0;
  let lastFailureTime = null;
  
  for (const service of services) {
    if (service.stats) {
      totalTodayFailures += service.stats.todayFailures || 0;
      
      if (service.stats.maxConsecutiveDays > totalConsecutiveDays) {
        totalConsecutiveDays = service.stats.maxConsecutiveDays;
      }
      
      if (service.stats.todayFailures > 0) {
        servicesWithFailures++;
      }
      
      if (service.stats.lastFailureTime) {
        const failureDate = parseBeijingTime(service.stats.lastFailureTime);
        if (!lastFailureTime || failureDate > parseBeijingTime(lastFailureTime)) {
          lastFailureTime = service.stats.lastFailureTime;
        }
      }
    }
  }
  
  return {
    totalTodayFailures,
    servicesWithFailures,
    maxConsecutiveDays: totalConsecutiveDays,
    lastFailureTime
  };
}

export function normalizeData(statusLines) {
  const rows = statusLines.split("\n");
  const dateNormalized = splitRowsByDate(rows);
  let relativeDateMap = {};
  const now = new Date();
  for (const [key, val] of Object.entries(dateNormalized)) {
    if (key == "upTime") {
      continue;
    }
    const relDays = getRelativeDays(now.getTime(), new Date(key).getTime());
    const avg = getDayAverage(val);
    if (avg === null) {
      relativeDateMap[relDays] = 'nodata';
    } else if (avg === 1) {
      relativeDateMap[relDays] = 'success';
    } else if (avg === 0) {
      relativeDateMap[relDays] = 'failure';
    } else {
      relativeDateMap[relDays] = 'partial';
    }
  }
  relativeDateMap.upTime = dateNormalized.upTime;
  return relativeDateMap;
}

export function calculateAvgLatency(logText, targetDate = null) {
  const lines = logText.split(/\r\n|\n/).filter(line => line.trim());
  let totalLatency = 0;
  let count = 0;
  
  const now = new Date();
  let startDate, endDate;
  
  if (targetDate) {
    startDate = new Date(targetDate);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
  } else {
    startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    endDate = now;
  }
  
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      if (data.status === 'success' && typeof data.latency === 'number') {
        const logDate = parseBeijingTime(data.time || data.timestamp);
        if (logDate >= startDate && logDate <= endDate) {
          totalLatency += data.latency;
          count++;
        }
      }
    } catch (e) {
      console.debug('[calculateAvgLatency] Parse error:', e.message);
    }
  }
  
  return count > 0 ? Math.round(totalLatency / count) : null;
}

export function parseLogData(logText) {
  const lines = logText.split(/\r\n|\n/).filter(line => line.trim());
  const dailyStatus = new Map();
  
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  
  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      const timeStr = data.time || data.timestamp;
      const logDate = parseBeijingTime(timeStr);
      
      if (logDate < cutoffDate || logDate > todayEnd) {
        continue;
      }
      
      const dateStr = logDate.toDateString();
      
      if (!dailyStatus.has(dateStr)) {
        dailyStatus.set(dateStr, { success: 0, failed: 0, total: 0 });
      }
      
      const dayData = dailyStatus.get(dateStr);
      dayData.total++;
      if (data.status === 'success') {
        dayData.success++;
      } else {
        dayData.failed++;
      }
    } catch (e) {
      console.debug('[parseLogData] Parse error:', e.message);
    }
  }
  
  const points = [];
  
  for (let i = maxDays - 1; i >= 0; i--) {
    const currentDate = new Date(now);
    currentDate.setDate(now.getDate() - i);
    const dateStr = currentDate.toDateString();
    
    let status;
    if (dailyStatus.has(dateStr)) {
      const dayData = dailyStatus.get(dateStr);
      if (dayData.total === 0) {
        status = 'nodata';
      } else if (dayData.failed === 0) {
        status = 'success';
      } else if (dayData.success === 0) {
        status = 'failure';
      } else {
        status = 'partial';
      }
    } else {
      status = 'nodata';
    }
    
    points.push({
      time: dateStr,
      status: status,
      latency: null,
      error: null
    });
  }
  
  return points;
}

function getDayAverage(val) {
  if (!val || val.length == 0) {
    return null;
  } else {
    return val.reduce((a, v) => a + v) / val.length;
  }
}

function getRelativeDays(dateend, datestart) {
  return Math.floor(Math.abs((dateend - datestart) / (24 * 3600 * 1000)));
}

function splitRowsByDate(rows) {
  let dateValues = {};
  let sum = 0,
    count = 0;
  
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  
  for (var ii = 0; ii < rows.length; ii++) {
    const row = rows[ii];
    if (!row) {
      continue;
    }
    let dateTimeStr, resultStr;
    
    try {
      const data = JSON.parse(row);
      dateTimeStr = data.time || data.timestamp;
      resultStr = data.status;
    } catch (e) {
      continue;
    }
    
    const dateTime = parseBeijingTime(dateTimeStr);
    
    if (dateTime < cutoffDate || dateTime > todayEnd) {
      continue;
    }
    
    const dateStr = dateTime.toDateString();
    let resultArray = dateValues[dateStr];
    if (!resultArray) {
      resultArray = [];
      dateValues[dateStr] = resultArray;
    }
    let result = 0;
    if (resultStr && resultStr === "success") {
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
