import { logspath } from "../index.js";

// 缓存对象
const logCache = {};

/**
 * 异步函数：获取日志文件内容。
 * 
 * 该函数通过HTTP请求从指定的URL获取日志文件的内容。如果请求成功，它将返回日志文本；
 * 如果请求失败，它将抛出一个错误。这个函数使用了fetch API来进行网络请求，并支持使用缓存。
 * 
 * @param {string} key - 日志文件名的关键字，用于构造URL。
 * @param {Object} uesCache - 控制是否使用缓存的对象，默认为使用'default'缓存策略。该参数的具体作用取决于fetch函数的实现。
 * @returns {Promise<string>} - 返回一个承诺，该承诺解析为日志文件的文本内容。
 * @throws {Error} - 如果请求失败，将抛出一个包含错误信息的异常。
 */
export async function reslogs(key, useCache = { cache: 'default' }) {
  const cacheKey = key + JSON.stringify(useCache);
  if (logCache[cacheKey]) {
    return logCache[cacheKey];
  }

  const url = logspath + "/" + key + "_report.log";
  const urlB = "./logs/" + key + "_report.log"; // 备选logspath

  try {
    const response = await fetch(url, useCache);
    // 如果请求失败，使用备选logspath
    if (!response.ok) {
      console.warn('Fetch failed. Attempting to use the alternate logspath.');
      const responseB = await fetch(urlB, useCache);
      const responsetext = await responseB.text();
      logCache[cacheKey] = responsetext;
      return responsetext;
    }
    // 请求成功，返回文本
    const responsetext = await response.text();
    logCache[cacheKey] = responsetext;
    return responsetext;
  } catch (error) {
    console.error(error);
  }
}