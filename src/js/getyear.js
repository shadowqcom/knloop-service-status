// 更新页脚年份
export async function getyear() {
  try {
      var currentYearElement = document.getElementById("currentYear");
      currentYearElement.textContent = new Date().getFullYear(); 
  } catch (error) {
      console.error("在更新年份时发生错误:", error);
  }
}