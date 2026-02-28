import { getConfig, onConfigLoaded } from './configLoader.js';
import { handleError } from './errorHandler.js';

let logspath = getConfig().logspath;

onConfigLoaded(config => {
  logspath = config.logspath;
});

const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 50;

class CacheEntry {
  constructor(data) {
    this.data = data;
    this.timestamp = Date.now();
  }
  
  isExpired() {
    return Date.now() - this.timestamp > CACHE_TTL;
  }
}

const logCache = new Map();

function cleanExpiredCache() {
  for (const [key, entry] of logCache.entries()) {
    if (entry.isExpired()) {
      logCache.delete(key);
    }
  }
}

function enforceMaxCacheSize() {
  if (logCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(logCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toDelete = entries.slice(0, logCache.size - MAX_CACHE_SIZE);
    for (const [key] of toDelete) {
      logCache.delete(key);
    }
  }
}

let cleanupInterval = null;

function startCleanupTimer() {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    cleanExpiredCache();
  }, CACHE_TTL);
}

function stopCleanupTimer() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

startCleanupTimer();

export function clearLogCache(key) {
  if (key) {
    logCache.delete(key);
  } else {
    logCache.clear();
  }
}

export function getCacheStats() {
  return {
    size: logCache.size,
    maxSize: MAX_CACHE_SIZE,
    ttl: CACHE_TTL
  };
}

export async function reslogs(key, useCache = { cache: 'default' }) {
  const cacheKey = key;
  const shouldUseCache = useCache.cache === 'default';
  
  if (shouldUseCache && logCache.has(cacheKey)) {
    const entry = logCache.get(cacheKey);
    if (!entry.isExpired()) {
      return entry.data;
    }
    logCache.delete(cacheKey);
  }

  const localUrl = "./logs/" + key + "_report.log";
  const remoteUrl = logspath + "/" + key + "_report.log";

  const isLocalhost = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1';

  const urls = isLocalhost ? [localUrl, remoteUrl] : [remoteUrl, localUrl];

  let lastError = null;
  
  for (const url of urls) {
    try {
      const fetchOptions = useCache.cache === 'no-cache' || useCache.cache === 'reload' 
        ? { cache: 'no-cache' } 
        : {};
      const response = await fetch(url, fetchOptions);
      if (response.ok) {
        const responsetext = await response.text();
        if (shouldUseCache) {
          logCache.set(cacheKey, new CacheEntry(responsetext));
          enforceMaxCacheSize();
        }
        return responsetext;
      }
    } catch (error) {
      lastError = error;
      handleError(error, `reslogs:${url}`);
    }
  }

  throw new Error(`Failed to fetch logs for ${key} from all sources: ${lastError?.message || 'unknown error'}`);
}

export { startCleanupTimer, stopCleanupTimer };
