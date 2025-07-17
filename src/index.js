import { genAllReports, getLastDayStatus } from './js/genReports.js';  // 导入生成所有报告的函数和获取最后一天状态的函数
import { lastupdated } from './js/lastupdated.js';                     // 导入记录最新更新时间的模块
import { getclieninfo } from './js/getclieninfo.js';                   // 导入获取客户端信息的函数
import { scrollheader } from './js/scroll.js';                         // 导入处理滚动事件以固定标题的函数
import { getyear } from './js/getyear.js';                             // 导入获取当前年份的函数
import { reloadReports } from './js/reloadreports.js';                 // 导入重新加载报告的函数
import { manualreload } from './js/manualreload.js';
import { swregister } from './js/swregister.js';
import { initScrollReveal } from './js/startanimation.js';



// 配置参数
export const maxDays = 60;                 // 日志最大展示天数
export const maxHour = 12;                 // 报表最大小时数
export const urlspath = "/src/urls.cfg";  // 配置文件路径,不带后/
export const logspath = "https://raw.github.knloop.com/knloop-service-status/page/logs";          // 日志文件路径,不带后/
export const reloadReportsdata = true;     // 是否重新加载报告
export const reloadReportstime = 2.5;        // 重载报告的检测间隔时间


// 主函数，异步执行一系列操作
async function main() {
  await Promise.all([
    initScrollReveal(),
    getclieninfo(),
    getyear(),
    lastupdated(),
    manualreload(),
    swregister(),
  ]);
  await Promise.all([
    genAllReports(),
    lastupdated(),
    getLastDayStatus(),
  ]);
  await Promise.all([
    scrollheader(),
    reloadReports(),
  ]);
}

main();
