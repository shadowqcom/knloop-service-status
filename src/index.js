import { genAllReports, getLastDayStatus, getyear } from './js/genReports.js';
import { lastupdated } from './js/lastupdated.js';
import { getclieninfo } from './js/getclieninfo.js';;

// 配置参数
export const maxDays = 60;
export const maxHour = 12;
export const urlspath = "./src/urls.cfg"; // 配置文件路径,不带后/
export const logspath = "./logs";  // 日志文件路径,不带后/

// 主函数入口
async function main() {
  genAllReports();
  getLastDayStatus();
  lastupdated();
  getclieninfo();
  getyear();
}

main();