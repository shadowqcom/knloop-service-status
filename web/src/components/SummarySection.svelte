<script lang="ts">
  import type { AvailabilityWindowKey, StatusKind, Summary } from '../lib/status';
  import { STATUS_TEXT_CLASS } from '../lib/status';

  interface Props {
    summary: Summary;
    overallStatus: StatusKind;
    lastUpdateText: string;
    refreshing: boolean;
    onRefresh: () => void;
  }

  let { summary, overallStatus, lastUpdateText, refreshing, onRefresh }: Props = $props();

  const windowTabs: Array<{ key: AvailabilityWindowKey; label: string }> = [
    { key: '24h', label: '24h' },
    { key: '7d', label: '7天' },
    { key: '30d', label: '30天' },
    { key: '60d', label: '60天' }
  ];

  let selectedWindow = $state<AvailabilityWindowKey>('60d');
  const fallbackWindow = { key: '60d' as const, label: '60 天', days: 60, availability: 0, checks: 0, nonSuccess: 0 };
  const activeWindow = $derived(summary.availabilityWindows.find((window) => window.key === selectedWindow) ?? summary.availabilityWindows[3] ?? fallbackWindow);
  const pct = $derived(Math.min(100, Math.max(0, activeWindow.availability)));
  const ringStyle = $derived(`conic-gradient(#00dfa2 0 ${pct}%, #ff0060 ${pct}% 100%)`);
  const iconClass = $derived(STATUS_TEXT_CLASS[overallStatus]);
  const circleClass = $derived({
    success: 'bg-success/15',
    failure: 'bg-failure/15',
    partial: 'bg-partial/15',
    nodata: 'bg-nodata/20'
  }[overallStatus]);

  function formatCompactCount(value: number): string {
    if (value >= 1000) {
      const thousands = value / 1000;
      const digits = thousands >= 100 ? 0 : 1;
      return thousands.toFixed(digits).replace(/\.0$/, '') + 'k';
    }
    return value.toLocaleString('zh-CN');
  }

  function formatPercent(value: number): string {
    return value.toFixed(2);
  }

  function formatIncidentDate(incident: { startDate: string; endDate: string }): string {
    const start = incident.startDate.slice(5);
    const end = incident.endDate.slice(5);
    return start === end ? start : start + '~' + end;
  }
</script>

<section class="mt-8 overflow-hidden rounded-lg bg-bg-secondary shadow-lg" data-testid="summary">
  <div class="flex flex-col gap-4 border-b border-gray-100 p-5 md:flex-row md:items-center md:justify-between md:p-6">
    <div class="flex items-start gap-3 md:items-center md:gap-4">
      <button
        type="button"
        onclick={onRefresh}
        disabled={refreshing}
        aria-label="手动刷新"
        data-testid="refresh-button"
        class="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 disabled:cursor-wait {circleClass}"
      >
        <svg class="h-5 w-5 {iconClass}" class:animate-spin={refreshing} aria-hidden="true">
          <use href={'/icons.svg#icon-' + overallStatus}></use>
        </svg>
      </button>
      <div class="min-w-0">
        <p class="text-base font-medium text-text-primary md:text-lg" data-testid="overall-status-text">{summary.statusText}</p>
        <p class="mt-0.5 text-xs leading-relaxed text-text-secondary">
          监控 <span class="font-medium text-text-primary">{summary.total}</span> 个服务 · 最后更新: <span data-testid="last-update">{lastUpdateText}</span>
        </p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 text-xs">
      <div class="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1.5">
        <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
        <span class="font-bold text-success">{summary.success}</span>
        <span class="text-text-secondary">正常</span>
      </div>
      <div class="flex items-center gap-1.5 rounded-full bg-partial/10 px-2.5 py-1.5">
        <span class="h-1.5 w-1.5 rounded-full bg-partial"></span>
        <span class="font-bold text-partial">{summary.partial}</span>
        <span class="text-text-secondary">异常</span>
      </div>
      <div class="flex items-center gap-1.5 rounded-full bg-failure/10 px-2.5 py-1.5">
        <span class="h-1.5 w-1.5 rounded-full bg-failure"></span>
        <span class="font-bold text-failure">{summary.failure}</span>
        <span class="text-text-secondary">故障</span>
      </div>
    </div>
  </div>

  <div class="grid md:grid-cols-[1.03fr_1.2fr]">
    <div class="flex flex-col border-b border-gray-100 p-4 md:border-b-0 md:border-r md:p-5">
      <div class="text-[11px] text-text-secondary">总体可用率 <span class="opacity-75">· 按检查次数加权</span></div>

      <div class="mt-2 flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {#each windowTabs as tab}
          <button
            type="button"
            aria-pressed={selectedWindow === tab.key}
            onclick={() => (selectedWindow = tab.key)}
            class="min-h-8 whitespace-nowrap rounded-md px-2 text-[11px] transition-colors {selectedWindow === tab.key ? 'bg-success/10 font-semibold text-success' : 'text-text-secondary hover:bg-gray-100'}"
          >
            {tab.label}
          </button>
        {/each}
      </div>

      <div class="mt-4 flex items-center gap-4 md:gap-6">
        <div
          class="relative h-[136px] w-[136px] flex-none rounded-full md:h-[158px] md:w-[158px]"
          style="background: {ringStyle}"
          role="img"
          aria-label={'可用率 ' + formatPercent(pct) + '%'}
        >
          <div class="absolute inset-[12px] flex flex-col items-center justify-center rounded-full bg-bg-secondary md:inset-[14px]">
            <span class="text-[25px] font-semibold leading-none tracking-[-0.05em] text-success md:text-[30px]">
              {formatPercent(pct)}<small class="ml-0.5 text-sm font-medium">%</small>
            </span>
            <span class="mt-1.5 text-[10px] text-text-secondary">{activeWindow.label}可用率</span>
          </div>
        </div>

        <div class="min-w-0">
          <div class="flex items-center gap-2 whitespace-nowrap text-xs text-text-secondary">
            <span class="h-1.5 w-1.5 flex-none rounded-full bg-success"></span>
            <span>成功</span>
            <b class="text-[13px] font-semibold text-text-primary">{formatPercent(pct)}%</b>
          </div>
          <div class="mt-2.5 flex items-center gap-2 whitespace-nowrap text-xs text-text-secondary">
            <span class="h-1.5 w-1.5 flex-none rounded-full bg-failure"></span>
            <span>非成功</span>
            <b class="text-[13px] font-semibold text-text-primary">{formatPercent(100 - pct)}%</b>
          </div>
          <div class="mt-3 border-t border-gray-100 pt-2.5 text-[11px] leading-relaxed text-text-secondary">
            <strong class="text-xs text-text-primary">{formatCompactCount(activeWindow.checks)}</strong> 次检查<br>
            其中 <strong class="text-xs text-text-primary">{formatCompactCount(activeWindow.nonSuccess)}</strong> 次非成功
          </div>
        </div>
      </div>

      <div class="mt-auto grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
        {#each summary.availabilityWindows.filter((window) => window.key !== '60d') as window}
          <div>
            <div class="text-sm font-semibold text-text-primary">{formatPercent(window.availability)}%</div>
            <div class="mt-0.5 text-[10px] text-text-secondary">{window.label}</div>
          </div>
        {/each}
      </div>
    </div>

    <div class="p-4 md:p-5">
      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-gray-100 bg-white/60 p-2.5">
          <div class="text-[19px] font-semibold leading-tight text-[#3b82f6]">{summary.avgP50 === null ? '--' : summary.avgP50 + 'ms'}</div>
          <div class="mt-1 text-[10px] leading-relaxed text-text-secondary">平均 P50<br>按服务加权</div>
        </div>
        <div class="rounded-lg border border-gray-100 bg-white/60 p-2.5">
          <div class="text-[19px] font-semibold leading-tight text-[#f59e0b]">{summary.avgP95 === null ? '--' : summary.avgP95 + 'ms'}</div>
          <div class="mt-1 text-[10px] leading-relaxed text-text-secondary">平均 P95<br>按服务加权</div>
        </div>
        <div class="rounded-lg border border-gray-100 bg-white/60 p-2.5">
          <div class="text-[19px] font-semibold leading-tight {summary.longestOutageDays > 0 ? 'text-failure' : 'text-text-primary'}">{summary.longestOutageDays}天</div>
          <div class="mt-1 text-[10px] text-text-secondary">最长连续中断</div>
        </div>
        <div class="rounded-lg border border-gray-100 bg-white/60 p-2.5">
          <div class="text-[19px] font-semibold leading-tight text-success">{summary.maxConsecutiveDays}天</div>
          <div class="mt-1 text-[10px] text-text-secondary">最长连续正常</div>
        </div>
      </div>

      <div class="mt-4 border-t border-gray-100 pt-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-[11px] font-medium text-text-primary">最近事件</h3>
          <span class="whitespace-nowrap text-[10px] text-text-secondary">过去 60 天 · {summary.abnormalDays} 个异常日</span>
        </div>
        {#if summary.recentIncidents.length === 0}
          <p class="pt-2 text-[11px] text-text-secondary">过去 60 天无异常事件</p>
        {:else}
          <ul class="mt-1">
            {#each summary.recentIncidents as incident}
              <li class="grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 border-b border-gray-50 py-2 text-[11px] last:border-0">
                <span class="text-[10px] text-text-secondary">{formatIncidentDate(incident)}</span>
                <span class="flex min-w-0 items-center gap-1.5 truncate">
                  <span class="h-1.5 w-1.5 flex-none rounded-full {incident.type === 'failure' ? 'bg-failure' : 'bg-partial'}"></span>
                  <span class="truncate">{incident.serviceTitle}</span>
                </span>
                <span class="rounded px-1.5 py-0.5 text-[9px] {incident.type === 'failure' ? 'bg-failure/10 text-failure' : 'bg-partial/10 text-partial'}">
                  {incident.type === 'failure' ? '故障' : '异常'}
                </span>
                <span class="col-start-2 col-span-2 text-[9px] text-text-secondary">{incident.days} 天</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
</section>
