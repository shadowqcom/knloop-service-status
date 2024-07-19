// 在DOM加载完成后，将滚动条的位置设置为最右侧
document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () {
      var containers = document.querySelectorAll(".statusStreamContainer");
      containers.forEach(function (container) {
        container.scrollLeft = container.scrollWidth;
      });
    }, 100); // 增加延迟
  });