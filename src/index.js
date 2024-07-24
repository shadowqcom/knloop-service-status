import { genAllReports, getLastDayStatus } from './js/genReports.js';
import { lastupdated } from './js/lastupdated.js';
import { getclieninfo } from './js/getclieninfo.js';
import { scrollheader } from './js/scroll.js';
import { getyear } from './js/getyear.js';

// 配置参数
export const maxDays = 60;
export const maxHour = 12;
export const urlspath = "./src/urls.cfg"; // 配置文件路径,不带后/
export const logspath = "https://raw.github.knloop.com/shadowqcom/knloop-service-status/main/logs";


// 主函数入口
async function main() {
  genAllReports();
  getLastDayStatus();
  scrollheader()
  lastupdated();
  getclieninfo();
  getyear();
}

main();