// 配置加载模块，确保config.json只被加载一次

// 配置对象
let config = {};
// 加载状态
let isLoading = false;
// 加载完成的回调函数
const loadCallbacks = [];
// 加载Promise
let loadingPromise = null;

/**
 * 加载配置
 * @returns {Promise<Object>} 配置对象
 */
export async function loadConfig() {
  if (loadingPromise) {
    return loadingPromise;
  }
  
  loadingPromise = (async () => {
    if (!isLoading) {
      isLoading = true;
      try {
        const response = await fetch('./src/config.json');
        const loadedConfig = await response.json();
        config = loadedConfig;
      } catch (error) {
        // 忽略错误
      } finally {
        isLoading = false;
        // 调用所有回调函数
        loadCallbacks.forEach(callback => callback(config));
      }
    }
    return config;
  })();
  
  return loadingPromise;
}

/**
 * 获取配置
 * @returns {Object} 配置对象
 */
export function getConfig() {
  return config;
}

/**
 * 注册配置加载完成的回调函数
 * @param {Function} callback 回调函数
 */
export function onConfigLoaded(callback) {
  if (!isLoading && !loadingPromise) {
    // 如果已经加载完成，立即调用回调
    callback(config);
  } else {
    // 否则添加到回调列表
    loadCallbacks.push(callback);
  }
}

// 立即加载配置
loadConfig();
