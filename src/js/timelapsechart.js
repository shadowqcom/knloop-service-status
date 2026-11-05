// Chart.js 惰性渲染：timelapsechart 只负责把 {labels, median, p95, yMax} 画出来。
// 不再解析日志、不做聚合（聚合在 statusModel.selectHourlyWindow）。
const CHART_SCRIPT_URL = './src/js/chart.umd.js';

let chartLibPromise = null;
const chartStates = new WeakMap();

/** 按需加载 206KB 的 Chart.js（IntersectionObserver 触发，首屏不请求） */
export function loadChartLibrary() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (chartLibPromise) return chartLibPromise;

  chartLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHART_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.Chart) resolve(window.Chart);
      else reject(new Error('Chart.js 未正确初始化'));
    };
    script.onerror = () => reject(new Error('Chart.js 加载失败'));
    document.head.appendChild(script);
  }).catch((error) => {
    chartLibPromise = null;
    throw error;
  });

  return chartLibPromise;
}

function skipped(context, value) {
  return context.p0.skip || context.p1.skip ? value : undefined;
}

function createChart(Chart, canvas, payload) {
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: payload.labels,
      datasets: [
        {
          label: '中位数',
          data: payload.median,
          fill: false,
          borderColor: '#3b82f6',
          tension: 0.4,
          segment: { borderDash: (context) => skipped(context, [4, 6]) },
          spanGaps: true,
          pointRadius: 4,
          pointHoverRadius: 6
        },
        {
          label: 'P95',
          data: payload.p95,
          fill: false,
          borderColor: '#f59e0b',
          tension: 0.4,
          segment: { borderDash: (context) => skipped(context, [4, 6]) },
          spanGaps: true,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          title: { display: false },
          ticks: { autoSkip: true, maxRotation: 65, minRotation: 0 }
        },
        y: {
          title: { display: false },
          beginAtZero: true,
          ...(payload.yMax ? { max: payload.yMax } : {})
        }
      }
    }
  });
}

function applyPayload(Chart, state, payload) {
  if (!state.instance) {
    state.instance = createChart(Chart, state.canvas, payload);
    state.rendered = true;
    return;
  }
  state.instance.data.labels = payload.labels;
  state.instance.data.datasets[0].data = payload.median;
  state.instance.data.datasets[1].data = payload.p95;
  state.instance.options.scales.y = {
    title: { display: false },
    beginAtZero: true,
    ...(payload.yMax ? { max: payload.yMax } : {})
  };
  state.instance.update('none');
  state.rendered = true;
}

async function renderState(state) {
  const payload = state.payload || state.getPayload?.();
  if (!payload) return;
  const token = (state.token || 0) + 1;
  state.token = token;
  try {
    const Chart = await loadChartLibrary();
    if (state.token !== token) return;
    applyPayload(Chart, state, payload);
  } catch (error) {
    console.debug('[timelapsechart] Chart.js 未就绪，跳过图表渲染:', error.message);
  }
}

/**
 * 观察 canvas：进入视口才加载 Chart.js 并渲染（契约 3.2）。
 * @param {HTMLCanvasElement} canvas
 * @param {() => {labels:string[],median:Array<number|null>,p95:Array<number|null>,yMax?:number}} getPayload
 */
export function observeChart(canvas, getPayload) {
  if (!canvas) return;
  let state = chartStates.get(canvas);
  if (!state) {
    state = { canvas, getPayload, payload: null, instance: null, observer: null, visible: false, rendered: false, token: 0 };
    chartStates.set(canvas, state);
  }
  state.getPayload = getPayload;

  if (state.observer) return;
  if (typeof IntersectionObserver === 'undefined') {
    state.visible = true;
    renderState(state);
    return;
  }

  state.observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      state.visible = true;
      state.observer?.disconnect();
      state.observer = null;
      renderState(state);
    }
  }, { rootMargin: '200px 0px' });
  state.observer.observe(canvas);
}

/** 数据/选中日期变化时更新图表；未进入视口时只记录 payload */
export function updateChartPayload(canvas, payload) {
  if (!canvas || !payload) return;
  const state = chartStates.get(canvas);
  if (!state) {
    observeChart(canvas, () => payload);
    return;
  }
  state.payload = payload;
  if (state.visible || state.instance) renderState(state);
}

export function destroyChart(canvas) {
  const state = chartStates.get(canvas);
  if (!state) return;
  state.observer?.disconnect();
  state.instance?.destroy?.();
  chartStates.delete(canvas);
}
