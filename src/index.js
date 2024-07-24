import { genAllReports } from './genReports.js';
import { lastupdated } from './lastupdated.js';
import { getclieninfo } from './getclieninfo.js';
import { getLastDayStatus } from './genReports.js';
import { getyear } from './genReports.js';

// 配置参数
const maxDays = 60;
const urlspath = "./src/urls.cfg";
const logspath = "./logs/";

// 主函数入口
async function main() {
  genAllReports(urlspath, logspath, maxDays);
  getLastDayStatus(urlspath, logspath);
  lastupdated(urlspath, logspath);
  getclieninfo();
  getyear();
}

main();