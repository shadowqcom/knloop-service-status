// 页面入口（Alpine 组件）：只负责状态与渲染，数据加载/解析全部交给 statusData.js + statusModel.js。
import { getConfig, loadConfig } from './configLoader.js';
import { createStatusController } from './statusData.js';
import {
  STATUS_BG_CLASS,
  STATUS_LABELS,
  STATUS_TEXT_CLASS,
  formatStatusPoint,
  selectHourlyWindow,
  summarize
} from './statusModel.js';
import { observeChart, updateChartPayload } from './timelapsechart.js';

const EMPTY_SUMMARY = summarize([]).summary;

window.statusApp = function () {
  return {
    services: [],
    summary: { ...EMPTY_SUMMARY },
    overallStatus: 'nodata',
    statusText: '暂无监控数据',
    statusClass: 'text-nodata',
    loading: true,
    refreshing: false,
    loadError: null,
    warnings: [],
    sourceLabel: '',
    lastUpdateText: '加载中...',
    generatedAtUnix: null,
    pollSeconds: 60,
    staleAfterMin: 45,
    skeletonCount: 3,
    currentYear: new Date().getFullYear(),

    _controller: null,
    _scrollHandler: null,
    _headerEl: null,
    _initialized: false,

    async init() {
      if (this._initialized) return; // Alpine 会自动调用 init()，避免 x-init 重复触发导致双份请求
      this._initialized = true;
      await loadConfig();
      const config = getConfig() || {};
      this.skeletonCount = Array.isArray(config.services) && config.services.length > 0 ? config.services.length : 3;
      this.pollSeconds = Number(config.pollIntervalSec) > 0 ? Number(config.pollIntervalSec) : 60;
      this.staleAfterMin = Number(config.staleAfterMin) > 0 ? Number(config.staleAfterMin) : 45;

      this.setupScrollListener();

      this._controller = createStatusController({
        onUpdate: (dashboard, info) => this.applyDashboard(dashboard, info),
        onPhase: (phase) => this.applyPhase(phase)
      });

      await this._controller.start();
    },

    destroy() {
      this._controller?.stop?.();
      this._controller = null;
      if (this._scrollHandler) {
        window.removeEventListener('scroll', this._scrollHandler);
        this._scrollHandler = null;
      }
    },

    applyPhase(phase) {
      if (typeof phase.refreshing === 'boolean') this.refreshing = phase.refreshing;
      if (typeof phase.loading === 'boolean') this.loading = phase.loading;
      if (phase.error && this.services.length === 0) {
        this.loadError = phase.message || '数据加载失败，请检查网络后重试';
      } else if (!phase.error) {
        this.loadError = null;
      }
    },

    applyDashboard(dashboard, info = {}) {
      if (!dashboard) {
        this.loading = false;
        this.loadError = info.error ? '数据加载失败，请检查网络后重试' : '暂无检测数据';
        this.lastUpdateText = '暂无数据';
        this.warnings = [];
        this.services = [];
        this.summary = { ...EMPTY_SUMMARY };
        return;
      }

      this.loading = false;
      this.loadError = null;
      this.warnings = Array.isArray(dashboard.warnings) ? dashboard.warnings : [];
      this.sourceLabel = dashboard.sourceLabel || '';
      this.lastUpdateText = dashboard.lastUpdateText || '暂无数据';
      this.generatedAtUnix = dashboard.generatedAtUnix ?? null;
      this.overallStatus = dashboard.overallStatus || 'nodata';
      this.statusText = dashboard.summary?.statusText || dashboard.statusText || '暂无监控数据';
      this.statusClass = dashboard.summary?.statusClass || dashboard.statusClass || 'text-nodata';

      // 契约 3.1：只有 generatedAtUnix 变新（或首次渲染）才重渲染服务列表
      if (!info.changed && this.services.length > 0) return;

      this.summary = dashboard.summary || { ...EMPTY_SUMMARY };
      this.services = (dashboard.services || []).map((service) => ({
        ...service,
        hoveredPoint: null,
        selectedDay: null,
        selectedDayLatency: null
      }));

      this.$nextTick(() => {
        this.attachCharts();
        this.scrollToRight();
      });
    },

    attachCharts() {
      for (const service of this.services) {
        const canvas = document.getElementById(`chart-${service.key}`);
        if (!canvas) continue;
        observeChart(canvas, () => this.chartPayload(service));
      }
    },

    chartPayload(service) {
      const config = getConfig() || {};
      const maxHour = Number(config.maxHour) > 0 ? Number(config.maxHour) : 12;
      return selectHourlyWindow(service, service.selectedDay, { now: Date.now(), maxHour });
    },

    selectDay(service, point) {
      if (!point || !point.date) return;
      service.selectedDay = point.date;
      service.selectedDayLatency = point.p50 ?? null;
      this.$nextTick(() => {
        const canvas = document.getElementById(`chart-${service.key}`);
        if (canvas) updateChartPayload(canvas, this.chartPayload(service));
      });
    },

    clearSelectedDay(service) {
      service.selectedDay = null;
      service.selectedDayLatency = null;
      this.$nextTick(() => {
        const canvas = document.getElementById(`chart-${service.key}`);
        if (canvas) updateChartPayload(canvas, this.chartPayload(service));
      });
    },

    scrollToRight() {
      if (window.innerWidth >= 768) return;
      requestAnimationFrame(() => {
        document.querySelectorAll('[x-ref="statusContainer"]').forEach((container) => {
          container.scrollLeft = container.scrollWidth;
        });
      });
    },

    /**
     * 顶部导航隐藏：passive + rAF 节流的原生监听，直接改 DOM class，
     * 不放进 Alpine 响应式 state（契约 3.2 交互修复）。
     */
    setupScrollListener() {
      this._headerEl = document.getElementById('site-header');
      let lastY = window.scrollY || 0;
      let ticking = false;

      const handler = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const currentY = window.scrollY || 0;
          const scrolledDown = currentY > lastY && currentY > 64;
          if (this._headerEl) {
            this._headerEl.classList.toggle('-translate-y-16', scrolledDown);
          }
          lastY = currentY;
          ticking = false;
        });
      };

      this._scrollHandler = handler;
      window.addEventListener('scroll', handler, { passive: true });
      handler();
    },

    async manualReload() {
      if (this.refreshing) return;
      this.refreshing = true;
      try {
        await this._controller?.manualRefresh?.();
      } finally {
        this.refreshing = false;
      }
    },

    get refreshHint() {
      return `自动刷新：每 ${this.pollSeconds} 秒`;
    },

    get dataSourceText() {
      return this.sourceLabel ? `数据源：${this.sourceLabel}` : '';
    },

    getStatusClass(status) {
      return STATUS_BG_CLASS[status] || 'bg-nodata';
    },

    getStatusTextClass(status) {
      return STATUS_TEXT_CLASS[status] || 'text-nodata';
    },

    getStatusLabel(status) {
      return STATUS_LABELS[status] || '无数据';
    },

    getServiceStatusIconHref(status) {
      return `./public/icons.svg#icon-${status || 'nodata'}`;
    },

    getServiceStatusColorClass(status) {
      return STATUS_TEXT_CLASS[status] || 'text-nodata';
    },

    formatPointInfo(point) {
      return formatStatusPoint(point);
    },

    formatAvgLatency(service) {
      if (service.selectedDay) {
        return service.selectedDayLatency !== null && service.selectedDayLatency !== undefined
          ? `当日 P50 延迟 ${service.selectedDayLatency}ms`
          : '当日暂无延迟数据';
      }
      return service.avgLatency !== null && service.avgLatency !== undefined
        ? `24小时内平均延迟 ${service.avgLatency}ms`
        : '24小时内暂无延迟数据';
    },

    formatUptime(service) {
      if (service.uptime === null || service.uptime === undefined) return '--';
      return service.uptime.toFixed(2);
    },

    formatSelectedDay(dayStr) {
      return dayStr ? `${dayStr} 全天数据` : '';
    }
  };
};

document.addEventListener('alpine:init', () => {
  Alpine.data('statusApp', statusApp);
});