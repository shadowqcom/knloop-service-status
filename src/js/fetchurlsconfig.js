import {urlspath} from '../index.js';


/**
 * 异步获取URL配置列表。
 * 
 * 该函数通过网络请求获取配置文件内容，随后处理这些内容以去除空行和注释行，
 * 最终返回一个包含所有有效配置行的数组。
 * 
 * @returns {Promise<Array<string>>} 返回一个Promise，解析为包含配置文件有效行的数组。
 */
export async function fetchUrlsConfig() {
    const response = await fetch(urlspath);
    const configText = await response.text();
    const configLines = configText.split(/\r\n|\n/).filter(entry => entry !== '').filter(line => !line.trim().startsWith("#"));
    return configLines;
}