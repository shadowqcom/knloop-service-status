import { getConfig, onConfigLoaded, loadConfig } from './configLoader.js';
import { fetchUrlsConfig } from './fetchurlsconfig.js';
import { normalizeData, parseLogData, calculateAvgLatency, calculateServiceStats } from './dataProcessing.js';
import { parseBeijingTime, formatDate } from './utils.js';
import { handleError } from './errorHandler.js';

let logspath = null;

onConfigLoaded(config => {
  logspath = config.logspath;
});

const CACHE_TTL = 5 * 60 * 1000;

class CacheEntry {
  constructor(data) {
    this.data = data;
    this.timestamp = Date.now();
  }
  
  isExpired() {
    return Date.now() - this.timestamp > CACHE_TTL;
  }
}

let dataCache = null;
let loadPromise = null;

export function clearCache() {
  dataCache = null;
  loadPromise = null;
}

export function getCacheStats() {
  return {
    hasCache: dataCache !== null,
    isExpired: dataCache ? dataCache.isExpired() : true,
    ttl: CACHE_TTL
  };
}

async function fetchLogContent(key, useCache = true) {
  const localUrl = "./logs/" + key + "_report.log";
  const remoteUrl = (logspath || getConfig().logspath) + "/" + key + "_report.log";

  const isLocalhost = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1';

  const urls = isLocalhost ? [localUrl, remoteUrl] : [remoteUrl, localUrl];
  const cacheOption = useCache ? 'default' : 'no-cache';

  let lastError = null;
  
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: cacheOption });
      if (response.ok) {
        return await response.text();
      }
    } catch (error) {
      lastError = error;
      handleError(error, `fetchLogContent:${url}`);
    }
  }

  throw new Error(`Failed to fetch logs for ${key} from all sources: ${lastError?.message || 'unknown error'}`);
}

function parseServiceData(key, url, logText) {
  const statusPoints = parseLogData(logText);
  const normalized = normalizeData(logText);
  const avgLatency = calculateAvgLatency(logText);
  const stats = calculateServiceStats(logText);
  
  const successCount = statusPoints.filter(p => p.status === 'success').length;
  const uptime = statusPoints.length > 0 
    ? ((successCount / statusPoints.length) * 100).toFixed(2) 
    : 0;

  return {
    key,
    title: key,
    url,
    statusPoints,
    uptime,
    avgLatency,
    rawLog: logText,
    lastStatus: normalized[0] || 'nodata',
    hoveredPoint: null,
    selectedDay: null,
    selectedDayLatency: null,
    stats
  };
}

function extractLatestTime(services) {
  const times = [];
  
  for (const service of services) {
    const logText = service.rawLog;
    const lines = logText.split(/\r\n|\n/).filter(l => l.trim());
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      try {
        const data = JSON.parse(lastLine);
        if (data.time) {
          times.push(data.time);
        }
      } catch (e) {
        console.debug('[extractLatestTime] Parse error:', e.message);
      }
    }
  }
  
  if (times.length > 0) {
    const latestTime = times.reduce((a, b) => {
      const dateA = parseBeijingTime(a);
      const dateB = parseBeijingTime(b);
      return dateA > dateB ? a : b;
    });
    const date = parseBeijingTime(latestTime);
    return formatDate(date, 'full');
  }
  
  return '暂无数据';
}

export async function loadAllLogData(forceRefresh = false) {
  if (!forceRefresh && dataCache && !dataCache.isExpired()) {
    return dataCache.data;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      await loadConfig();
      const configLines = await fetchUrlsConfig();
      
      const fetchPromises = configLines.map(async (line) => {
        const [key, url] = line.split('=');
        const logText = await fetchLogContent(key, !forceRefresh);
        return parseServiceData(key, url, logText);
      });
      
      const services = await Promise.all(fetchPromises);
      const lastUpdateTime = extractLatestTime(services);
      
      const result = {
        services,
        lastUpdateTime
      };
      
      dataCache = new CacheEntry(result);
      return result;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export async function getLatestLogTime() {
  const configLines = await fetchUrlsConfig();
  const randomIndex = Math.floor(Math.random() * configLines.length);
  const randomLine = configLines[randomIndex];
  const [key] = randomLine.split('=');
  
  const logText = await fetchLogContent(key, false);
  const lines = logText.split(/\r\n|\n/).filter(l => l.trim());
  
  return lines.length > 0 ? lines[lines.length - 1].split(',')[0] : null;
}
