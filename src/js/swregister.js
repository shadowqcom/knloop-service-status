export function swregister() {
    window.addEventListener('load', () => {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("./src/js/sw.js")
                .catch(function () {
                    ServiceWorkerContainer.register('./src/js/sw.js')
                });
        }
    });

    // 检测是否处于 PWA 独立窗口模式。
    if (window.matchMedia('(display-mode: standalone)').matches) {
        // 如果是 PWA 独立窗口，隐藏滚动条
        const style = document.createElement('style');
        style.innerHTML = '::-webkit-scrollbar { display: none; }';
        document.head.appendChild(style);

        // 隐藏头部
        document.querySelector('header').style.display = 'none';
        // 重设标题顶部距离
        document.querySelector('.headline').style.margin = '1.2rem auto 0rem';
    }
}