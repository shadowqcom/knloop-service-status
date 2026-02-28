import { getConfig, loadConfig } from './configLoader.js';

// 缓存对象
const urlConfigCache = {};

/**
 * 异步获取URL配置列表。
 *
 * 该函数通过网络请求获取配置文件内容，随后处理这些内容以返回服务配置。
 *
 * @returns {Promise<Array<string>>} 返回一个Promise，解析为包含配置文件有效行的数组
 */
export async function fetchUrlsConfig() {
  if (urlConfigCache['urlsConfig']) {
    return urlConfigCache['urlsConfig'];
  }

  // 确保配置已加载
  await loadConfig();
  const config = getConfig();
  const services = config.services || [];
  const configLines = services.map(service => `${service.key}=${service.url}`);

  urlConfigCache['urlsConfig'] = configLines;
  return configLines;
}