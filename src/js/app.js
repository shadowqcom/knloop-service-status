import { fetchUrlsConfig } from './fetchurlsconfig.js';
import { reslogs, clearLogCache } from './reslogs.js';
import { normalizeData, parseLogData, calculateAvgLatency, calculateServiceStats, calculateGlobalStats } from './dataProcessing.js';
import { updateChart } from './timelapsechart.js';
import { getConfig, onConfigLoaded, loadConfig } from './configLoader.js';
import { parseBeijingTime, formatDate, STATUS_MAP, STATUS_COLOR_MAP, STATUS_BG_MAP } from './utils.js';
import { handleError, getErrorMessage, ERROR_TYPES } from './errorHandler.js';

let reloadReportsdata = getConfig().reloadReportsdata;
let reloadReportstime = getConfig().reloadReportstime;
let maxDays = getConfig().maxDays;

onConfigLoaded(config => {
  reloadReportsdata = config.reloadReportsdata;
  reloadReportstime = config.reloadReportstime;
  maxDays = config.maxDays;
});

window.statusApp = function() {
  return {
    services: [],
    loading: true,
    loadError: null,
    lastUpdateTime: '加载中...',
    currentYear: new Date().getFullYear(),
    userAgent: navigator.userAgent,
    scrolledDown: false,
    overallStatus: 'nodata',
    lastScrollY: 0,
    reloadInterval: null,
    nextReloadCountdown: 0,
    countdownInterval: null,
    countdownDisplay: '0:00',

    async init() {
      await loadConfig();
      await this.loadAllData();
      this.setupScrollListener();
      this.setupAutoReload();
    },

    async loadAllData(useCache = { cache: 'default' }) {
      this.loading = true;
      this.loadError = null;
      try {
        const configLines = await fetchUrlsConfig();
        const servicePromises = configLines.map(line => this.loadServiceData(line, useCache));
        const services = await Promise.all(servicePromises);
        this.services = services;
        this.calculateOverallStatus();
        await this.updateLastTime();
        
        this.$nextTick(() => {
          this.renderCharts();
          this.scrollToRight();
        });
      } catch (error) {
        this.loadError = handleError(error, 'loadAllData');
      } finally {
        this.loading = false;
      }
    },

    scrollToRight() {
      setTimeout(() => {
        const isMobile = window.innerWidth < 768;
        if (!isMobile) return;
        
        const containers = document.querySelectorAll('[x-ref="statusContainer"]');
        containers.forEach(container => {
          container.scrollLeft = container.scrollWidth;
        });
      }, 100);
    },

    onScroll(event) {
      // 可以在这里添加滚动相关的逻辑
    },

    async loadServiceData(configLine, useCache) {
      const [key, url] = configLine.split('=');
      const logText = await reslogs(key, useCache);
      const statusPoints = parseLogData(logText);
      const normalized = normalizeData(logText);
      const avgLatency = calculateAvgLatency(logText);
      const stats = calculateServiceStats(logText);
      
      const successCount = statusPoints.filter(p => p.status === 'success').length;
      const uptime = statusPoints.length > 0 
        ? ((successCount / statusPoints.length) * 100).toFixed(2) 
        : 0;

      return {
        key,
        title: key,
        url,
        statusPoints,
        uptime,
        avgLatency,
        rawLog: logText,
        lastStatus: normalized[0] || 'nodata',
        hoveredPoint: null,
        selectedDay: null,
        selectedDayLatency: null,
        stats
      };
    },

    calculateOverallStatus() {
      const statuses = this.services.map(s => s.lastStatus);
      const total = statuses.length;
      const successCount = statuses.filter(s => s === 'success').length;
      const failureCount = statuses.filter(s => s === 'failure').length;
      const nodataCount = statuses.filter(s => s === 'nodata').length;
      
      const failureThreshold = total * 0.2;
      const nodataThreshold = total * 0.5;

      if (successCount === total) {
        this.overallStatus = 'success';
      } else if (nodataCount === total) {
        this.overallStatus = 'nodata';
      } else if (failureCount >= failureThreshold || nodataCount >= nodataThreshold) {
        this.overallStatus = 'failure';
      } else {
        this.overallStatus = 'partial';
      }
    },

    async updateLastTime() {
      try {
        const configLines = await fetchUrlsConfig();
        const times = [];
        
        for (const line of configLines) {
          const [key] = line.split('=');
          const logText = await reslogs(key, { cache: 'default' });
          const lines = logText.split(/\r\n|\n/).filter(l => l.trim());
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            try {
              const data = JSON.parse(lastLine);
              if (data.time) {
                times.push(data.time);
              }
            } catch (e) {
              // 单行解析错误不影响整体
            }
          }
        }
        
        if (times.length > 0) {
          const latestTime = times.reduce((a, b) => {
            const dateA = parseBeijingTime(a);
            const dateB = parseBeijingTime(b);
            return dateA > dateB ? a : b;
          });
          const date = parseBeijingTime(latestTime);
          this.lastUpdateTime = formatDate(date, 'full');
        }
      } catch (error) {
        handleError(error, 'updateLastTime');
      }
    },

    renderCharts() {
      this.services.forEach(service => {
        const canvas = document.getElementById(`chart-${service.key}`);
        if (canvas) {
          updateChart(canvas, service.rawLog, service.selectedDay);
        }
      });
    },

    selectDay(service, point) {
      service.selectedDay = point.time;
      service.selectedDayLatency = calculateAvgLatency(service.rawLog, point.time);
      this.$nextTick(() => {
        const canvas = document.getElementById(`chart-${service.key}`);
        if (canvas) {
          updateChart(canvas, service.rawLog, point.time);
        }
      });
    },

    clearSelectedDay(service) {
      service.selectedDay = null;
      service.selectedDayLatency = null;
      this.$nextTick(() => {
        const canvas = document.getElementById(`chart-${service.key}`);
        if (canvas) {
          updateChart(canvas, service.rawLog, null);
        }
      });
    },

    formatSelectedDay(dayStr) {
      if (!dayStr) return '';
      const date = new Date(dayStr);
      return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} 全天数据`;
    },

    formatSelectedDayShort(dayStr) {
      if (!dayStr) return '';
      const date = new Date(dayStr);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    },

    setupScrollListener() {
      window.addEventListener('scroll', () => {
        const currentScrollY = window.scrollY;
        this.scrolledDown = currentScrollY > this.lastScrollY && currentScrollY > 64;
        this.lastScrollY = currentScrollY;
      });
    },

    setupAutoReload() {
      if (!reloadReportsdata) return;
      
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      
      const intervalSeconds = Math.floor(reloadReportstime * 60);
      let startTime = this.lastUpdateTime;
      let lastTick = Date.now();

      this.nextReloadCountdown = intervalSeconds;
      this.updateCountdownDisplay();
      
      this.countdownInterval = setInterval(() => {
        const now = Date.now();
        const elapsed = now - lastTick;
        
        if (elapsed >= 1000) {
          lastTick = now;
          this.nextReloadCountdown--;
          this.updateCountdownDisplay();
          
          if (this.nextReloadCountdown <= 0) {
            this.nextReloadCountdown = intervalSeconds;
            this.updateCountdownDisplay();
            
            this.checkAndReload(startTime).then(newTime => {
              if (newTime) startTime = newTime;
            });
          }
        }
      }, 100);
    },

    updateCountdownDisplay() {
      const minutes = Math.floor(this.nextReloadCountdown / 60);
      const seconds = this.nextReloadCountdown % 60;
      this.countdownDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    },

    async checkAndReload(startTime) {
      try {
        const newTime = await this.getLatestTime();
        if (startTime !== newTime) {
          clearLogCache();
          await this.loadAllData({ cache: 'no-cache' });
          return newTime;
        }
      } catch (error) {
        handleError(error, 'checkAndReload');
      }
      return null;
    },

    async getLatestTime() {
      const configLines = await fetchUrlsConfig();
      const randomIndex = Math.floor(Math.random() * configLines.length);
      const randomLine = configLines[randomIndex];
      const [key] = randomLine.split('=');
      const logText = await reslogs(key, { cache: 'no-cache' });
      const lines = logText.split(/\r\n|\n/).filter(l => l.trim());
      return lines.length > 0 ? lines[lines.length - 1].split(',')[0] : null;
    },

    async manualReload() {
      if (this.loading) return;
      
      clearLogCache();
      this.loading = true;
      
      try {
        const configLines = await fetchUrlsConfig();
        const servicePromises = configLines.map(line => this.loadServiceData(line, { cache: 'reload' }));
        const services = await Promise.all(servicePromises);
        this.services = services;
        this.calculateOverallStatus();
        await this.updateLastTime();
        
        this.$nextTick(() => {
          this.renderCharts();
          this.scrollToRight();
        });
        
        const intervalSeconds = Math.floor(reloadReportstime * 60);
        this.nextReloadCountdown = intervalSeconds;
        this.updateCountdownDisplay();
      } catch (error) {
        this.loadError = handleError(error, 'manualReload');
      } finally {
        this.loading = false;
      }
    },
    
    getErrorMessage() {
      return this.loadError ? getErrorMessage(this.loadError) : '';
    },

    get serviceSummary() {
      const emptySummary = {
        total: 0,
        success: 0,
        failure: 0,
        partial: 0,
        nodata: 0,
        avgUptime: 0,
        avgLatency: 0,
        statusText: '暂无数据',
        statusClass: 'text-nodata',
        todayFailures: 0,
        servicesWithFailures: 0,
        maxConsecutiveDays: 0,
        lastFailureTime: null
      };

      if (this.services.length === 0) {
        return emptySummary;
      }

      const total = this.services.length;
      const success = this.services.filter(s => s.lastStatus === 'success').length;
      const failure = this.services.filter(s => s.lastStatus === 'failure').length;
      const partial = this.services.filter(s => s.lastStatus === 'partial').length;
      const nodata = this.services.filter(s => s.lastStatus === 'nodata').length;

      const avgUptime = this.services.reduce((sum, s) => sum + parseFloat(s.uptime || 0), 0) / total;
      const latencies = this.services.filter(s => s.avgLatency).map(s => s.avgLatency);
      const avgLatency = latencies.length > 0 
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) 
        : 0;

      const globalStats = calculateGlobalStats(this.services);

      let statusText = '';
      let statusClass = '';

      if (success === total) {
        statusText = '所有服务运行正常';
        statusClass = 'text-success';
      } else if (failure > 0 && failure === total) {
        statusText = '所有服务均不可用';
        statusClass = 'text-failure';
      } else if (failure > 0) {
        statusText = `${failure} 个服务故障`;
        statusClass = 'text-failure';
      } else if (partial > 0) {
        statusText = `${partial} 个服务部分故障`;
        statusClass = 'text-partial';
      } else if (nodata === total) {
        statusText = '暂无监控数据';
        statusClass = 'text-nodata';
      } else {
        statusText = '服务运行中';
        statusClass = 'text-success';
      }

      return {
        total,
        success,
        failure,
        partial,
        nodata,
        avgUptime: avgUptime.toFixed(2),
        avgLatency,
        statusText,
        statusClass,
        todayFailures: globalStats.totalTodayFailures,
        servicesWithFailures: globalStats.servicesWithFailures,
        maxConsecutiveDays: globalStats.maxConsecutiveDays,
        lastFailureTime: globalStats.lastFailureTime
      };
    },

    get formattedCountdown() {
      if (this.nextReloadCountdown <= 0) return '';
      const minutes = Math.floor(this.nextReloadCountdown / 60);
      const seconds = this.nextReloadCountdown % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    },

    get checkInterval() {
      return reloadReportstime;
    },

    get statusIconHref() {
      return `./public/icons.svg#icon-${this.overallStatus}`;
    },

    get statusColorClass() {
      return STATUS_COLOR_MAP[this.overallStatus] || 'text-nodata';
    },

    getStatusClass(status) {
      return STATUS_BG_MAP[status] || 'bg-nodata';
    },

    getServiceStatusIconHref(status) {
      return `./public/icons.svg#icon-${status || 'nodata'}`;
    },

    getServiceStatusColorClass(status) {
      return STATUS_COLOR_MAP[status] || 'text-nodata';
    },

    formatTooltip(point) {
      return `${point.time} - ${point.status}${point.latency ? ` (${point.latency}ms)` : ''}`;
    },

    formatPointInfo(point) {
      if (!point) return '';
      const date = new Date(point.time);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const dateStr = `${date.getFullYear()}-${month}-${day}`;
      return `${dateStr} - ${STATUS_MAP[point.status] || point.status}`;
    },

    formatAvgLatency(service) {
      if (service.selectedDay) {
        const latency = service.selectedDayLatency;
        return latency ? `当日平均延迟 ${latency}ms` : '当日暂无数据';
      } else {
        const latency = service.avgLatency;
        return latency ? `24小时内平均延迟 ${latency}ms` : '暂无数据';
      }
    },

    getStatusBlockWidth() {
      const isMobile = window.innerWidth < 768;
      
      if (isMobile) {
        return 12;
      }
      
      const container = document.querySelector('[x-ref="statusContainer"]');
      let containerWidth;
      
      if (container && container.clientWidth > 0) {
        containerWidth = container.clientWidth;
      } else {
        const maxContainerWidth = 896;
        const padding = 48;
        const windowWidth = window.innerWidth;
        containerWidth = Math.min(windowWidth - padding, maxContainerWidth - 48);
      }
      
      const effectiveMaxDays = Math.min(maxDays, 60);
      
      const defaultGap = 2;
      const defaultTotalGaps = (60 - 1) * defaultGap;
      const defaultAvailableWidth = containerWidth - defaultTotalGaps;
      const defaultBlockWidth = defaultAvailableWidth / 60;
      
      if (maxDays >= 60) {
        return Math.max(defaultBlockWidth, 3);
      }
      
      const minBlockWidth = Math.max(defaultBlockWidth, 3);
      const totalBlockWidth = minBlockWidth * effectiveMaxDays;
      const remainingWidth = containerWidth - totalBlockWidth;
      
      const maxGap = Math.floor(remainingWidth / (effectiveMaxDays - 1 || 1));
      const newGap = Math.min(maxGap, 8);
      
      const newTotalGaps = (effectiveMaxDays - 1) * newGap;
      const newAvailableWidth = containerWidth - newTotalGaps;
      const newBlockWidth = newAvailableWidth / effectiveMaxDays;
      
      return Math.max(newBlockWidth, 3);
    },

    getStatusBlockStyle() {
      const isMobile = window.innerWidth < 768;
      const width = this.getStatusBlockWidth();
      
      if (isMobile) {
        return `width: ${width}px; min-width: ${width}px;`;
      } else {
        return `width: ${width}px;`;
      }
    },

    getStatusBlockGap() {
      const isMobile = window.innerWidth < 768;
      
      if (isMobile) {
        return 2;
      }
      
      const container = document.querySelector('[x-ref="statusContainer"]');
      let containerWidth;
      
      if (container && container.clientWidth > 0) {
        containerWidth = container.clientWidth;
      } else {
        const maxContainerWidth = 896;
        const padding = 48;
        const windowWidth = window.innerWidth;
        containerWidth = Math.min(windowWidth - padding, maxContainerWidth - 48);
      }
      
      const effectiveMaxDays = Math.min(maxDays, 60);
      
      if (maxDays >= 60) {
        return 2;
      }
      
      const defaultGap = 2;
      const defaultTotalGaps = (60 - 1) * defaultGap;
      const defaultAvailableWidth = containerWidth - defaultTotalGaps;
      const defaultBlockWidth = defaultAvailableWidth / 60;
      
      const minBlockWidth = Math.max(defaultBlockWidth, 3);
      const totalBlockWidth = minBlockWidth * effectiveMaxDays;
      const remainingWidth = containerWidth - totalBlockWidth;
      
      const maxGap = Math.floor(remainingWidth / (effectiveMaxDays - 1 || 1));
      return Math.min(maxGap, 8);
    },

    getStatusContainerStyle() {
      const gap = this.getStatusBlockGap();
      return `gap: ${gap}px;`;
    }
  };
};

document.addEventListener('alpine:init', () => {
  Alpine.data('statusApp', statusApp);
});
