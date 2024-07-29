// 初始化页面加载动效
export function initScrollReveal() {
  // 添加对文档的 class 操作
  const doc = document.documentElement
  doc.classList.remove('no-js')
  doc.classList.add('js')

  if (document.body.classList.contains('has-animations')) {
    // 初始化 ScrollReveal
    const sr = window.sr = ScrollReveal()

    // 使用 ScrollReveal
    sr.reveal('.hero-title, .lastUpdatedTime', {
      duration: 1000,
      distance: '30px',
      easing: 'cubic-bezier(0.5, -0.01, 0, 1.005)',
      origin: 'bottom',
      interval: 150
    })

    sr.reveal('.reportContainer, .bubble-4, .hero-browser-inner, .bubble-1, .bubble-2', {
      duration: 1000,
      scale: 0.95,
      easing: 'cubic-bezier(0.5, -0.01, 0, 1.005)',
      interval: 150
    })

    sr.reveal('.feature', {
      duration: 600,
      distance: '40px',
      easing: 'cubic-bezier(0.5, -0.01, 0, 1.005)',
      interval: 100,
      origin: 'bottom',
      viewFactor: 0.5
    })
  }
}
