export function swregister() {
    window.addEventListener('load', function () {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("./src/js/sw.js")
                .catch(function () {
                    ServiceWorkerContainer.register('./src/js/sw.js')
                });
        }
    });
}