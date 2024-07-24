// 更新页脚年份
export function getyear() {
    var currentYearElement = document.getElementById("currentYear");
    currentYearElement.textContent = new Date().getFullYear(); // 更新为当前年份
  }