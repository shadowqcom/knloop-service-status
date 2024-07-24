// 将每个状态列表横条滚动到最右端。
export async function scrolltoright() {
    var containers = document.querySelectorAll(".statusStreamContainer");
    containers.forEach(function (container) {
        const finalScrollLeft = container.scrollWidth;
        const currentScrollLeft = container.scrollLeft;
        const duration = 700; // 动画持续时间，单位毫秒
        const startTime = performance.now();

        function step(timestamp) {
            const progress = Math.min(1, (timestamp - startTime) / duration);
            container.scrollLeft = currentScrollLeft + (finalScrollLeft - currentScrollLeft) * progress;

            if (progress < 1) {
                requestAnimationFrame(step);
            }
        }

        requestAnimationFrame(step);
    });
}

export async function scrollheader() {
    // 获取头部元素和页面滚动事件
    const header = document.querySelector('header');
    window.addEventListener('scroll', () => {
        // 只要滚动就添加隐藏类
        if (window.scrollY > 210) {
            header.classList.add('hidden');
        } else {
            header.classList.remove('hidden');
        }
    });
}






