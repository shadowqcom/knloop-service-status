import { genAllReports, getLastDayStatus, getyear } from './js/genReports.js';
import { lastupdated } from './js/lastupdated.js';
import { getclieninfo } from './js/getclieninfo.js';;

// 配置参数
const maxDays = 60;
const urlspath = "./src/urls.cfg"; // 配置文件路径,不带后/
const logspath = "./logs";  // 日志文件路径,不带后/

// 主函数入口
async function main() {
  genAllReports(urlspath, logspath, maxDays);
  getLastDayStatus(urlspath, logspath);
  lastupdated(urlspath, logspath);
  getclieninfo();
  getyear();
}

main();