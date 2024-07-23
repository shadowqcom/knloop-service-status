// 将每个状态列表横条滚动到最右端。
export async function scrollToRightEnd() {
    var containers = document.querySelectorAll(".statusStreamContainer");
    containers.forEach(function (container) {
        container.scrollLeft = container.scrollWidth;
    });
  }