import {showLoadingMask, hideLoadingMask, clearReports, getlastTime } from "./reloadreports.js";
import { genAllReports, getLastDayStatus } from "./genReports.js";
import { refreshLastupdatedon } from "./lastupdated.js";

export function manualreload() {
    return new Promise((resolve) => {
        document.addEventListener('DOMContentLoaded', function () {
            const reloadBtn = document.getElementById('statusImg');
            reloadBtn.addEventListener('click', throttle(reloadall, 1000));
            resolve();
        });
    });
}

function throttle(func, wait) {
    let lastTime = 0;
    return function (...args) {
        const now = Date.now();
        if (now - lastTime >= wait) {
            func.apply(this, args);
            lastTime = now;
        }
    };
}
async function reloadall() {
    const useCache = { cache: 'reload' };  // 不使用缓存
    const lastTime = await getlastTime();

    console.log("reloadallreports");
    showLoadingMask(); // 显示加载动画
    clearReports(); // 清理旧的报告
    await genAllReports(useCache); // 生成新的报告
    await getLastDayStatus(useCache);
    refreshLastupdatedon(lastTime);  // 刷新 Last updated on
    hideLoadingMask(); // 隐藏加载动画
}