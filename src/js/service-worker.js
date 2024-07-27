// 注册 Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./src/js/service-worker.js').then(registration => {
      }).catch(error => {
        console.error('Service Worker 注册失败:', error);
      });
    });
  }
  
  // 监听安装事件，提醒用户安装 PWA
  self.addEventListener('install', event => {
    event.waitUntil(
      self.skipWaiting()
    );
  });
  
  self.addEventListener('activate', event => {
    event.waitUntil(
      self.clients.claim()
    );
  });