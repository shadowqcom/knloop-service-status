import { logspath } from '../index.js';

/* 
* 统一读取并处理所有.log文件，供其他地方使用。
* 
* 使用缓存
* const responseText = await reslogs('example_key');
*
* 不使用缓存，强制从服务器获取数据
* const Timestamp = Date.now();
* const freshResponseText = await reslogs('example_key', Timestamp);
*/

const cache = {}; // 创建一个缓存对象，用于存储单例 Promise 实例

export async function reslogs(key, timestamp) {
  // 如果传入了 timestamp，则不使用缓存
  if (timestamp !== undefined) {
    const response = await fetch(logspath + "/" + key + "_report.log?" + "ts=" + timestamp);
    const responsetext = await response.text(); // 读取响应文本
    return responsetext; // 返回响应文本
  }

  // 检查缓存中是否存在对应 key 的结果
  if (!cache[key]) {
    // 如果缓存中没有对应 key 的结果，则创建一个新的 Promise 实例
    cache[key] = (async () => {
      const response = await fetch(logspath + "/" + key + "_report.log");
      const responsetext = await response.text(); // 读取响应文本
      return responsetext;
    })();
  }

  // 返回缓存的 Promise 实例    
  return cache[key];
}