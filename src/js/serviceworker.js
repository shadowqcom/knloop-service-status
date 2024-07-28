self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open('v1').then(function (cache) {
            return cache.addAll([
                '/',
                '/index.html',
                '/src/urls.cfg',
                '/src/index.css',
                '/src/index.js',
                '/src/js/chart.umd.js',
                '/src/js/dataProcessing.js',
                '/src/js/domManipulation.js',
                '/src/js/fetchurlsconfig.js',
                '/src/js/genReports.js',
                '/src/js/getclieninfo.js',
                '/src/js/getyear.js',
                '/src/js/lastupdated.js',
                '/src/js/reloadreports.js',
                '/src/js/reslogs.js',
                '/src/js/scroll.js',
                '/src/js/timelapsechart.js',
                '/src/js/tooltip.js',
                '/src/js/utils.js',
                '/public/favicon.ico',
                '/public/logo.svg',
                '/public/logo.png',
                '/public/check/degraded.svg',
                '/public/check/down.svg',
                '/public/check/nodata.svg',
                '/public/check/up.svg'
            ]);
        })
    );
});

self.addEventListener('fetch', function (event) {
    event.respondWith(
        caches.match(event.request).then(function (response) {
            return response || fetch(event.request);
        })
    );
});