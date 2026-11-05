<script lang="ts">
  import type { StatusKind, Summary } from '../lib/status';
  import { STATUS_TEXT_CLASS } from '../lib/status';

  interface Props {
    summary: Summary;
    overallStatus: StatusKind;
    lastUpdateText: string;
    dataSourceText: string;
    refreshHint: string;
    refreshing: boolean;
    lastFailureTime: string | null;
    onRefresh: () => void;
  }

  let {
    summary,
    overallStatus,
    lastUpdateText,
    dataSourceText,
    refreshHint,
    refreshing,
    lastFailureTime,
    onRefresh
  }: Props = $props();

  const iconClass = $derived(STATUS_TEXT_CLASS[overallStatus]);
  const circleClass = $derived({
    success: 'bg-success/15',
    failure: 'bg-failure/15',
    partial: 'bg-partial/15',
    nodata: 'bg-nodata/20'
  }[overallStatus]);
</script>

<section class="mt-8 overflow-hidden rounded-lg bg-bg-secondary shadow-lg" data-testid="summary">
  <div class="border-b border-gray-100 p-6">
    <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center gap-4">
        <button
          type="button"
          onclick={onRefresh}
          disabled={refreshing}
          aria-label="手动刷新"
          data-testid="refresh-button"
          class="flex h-16 w-16 flex-shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 disabled:cursor-wait {circleClass}"
        >
          <svg class="h-8 w-8 {iconClass}" class:animate-spin={refreshing} aria-hidden="true">
            <use href={'/icons.svg#icon-' + overallStatus}></use>
          </svg>
        </button>
        <div>
          <p class="text-xl font-medium text-text-primary" data-testid="overall-status-text">{summary.statusText}</p>
          <p class="text-sm leading-relaxed text-text-secondary">
            <span class="block sm:inline">监控 <span class="font-medium text-text-primary">{summary.total}</span> 个服务</span>
            <span class="hidden sm:inline"> · </span>
            <span class="block sm:inline">最后更新: <span data-testid="last-update">{lastUpdateText}</span></span>
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-4 text-sm">
        <div class="flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5">
          <div class="h-2 w-2 rounded-full bg-success"></div>
          <span class="text-base font-bold text-success">{summary.success}</span>
          <span class="text-text-secondary">正常</span>
        </div>
        <div class="flex items-center gap-2 rounded-full bg-partial/10 px-3 py-1.5">
          <div class="h-2 w-2 rounded-full bg-partial"></div>
          <span class="text-base font-bold text-partial">{summary.partial}</span>
          <span class="text-text-secondary">异常</span>
        </div>
        <div class="flex items-center gap-2 rounded-full bg-failure/10 px-3 py-1.5">
          <div class="h-2 w-2 rounded-full bg-failure"></div>
          <span class="text-base font-bold text-failure">{summary.failure}</span>
          <span class="text-text-secondary">故障</span>
        </div>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-2 md:grid-cols-4">
    <div class="bg-bg-secondary p-4 text-center">
      <p class="text-2xl font-medium text-text-primary" data-testid="avg-uptime">{summary.avgUptime}%</p>
      <p class="mt-1 text-xs text-text-secondary">60天可用率</p>
    </div>
    <div class="bg-bg-secondary p-4 text-center">
      <p class="text-2xl font-medium {summary.avgLatency > 0 ? 'text-text-primary' : 'text-text-secondary'}">
        {summary.avgLatency > 0 ? summary.avgLatency + 'ms' : '-'}
      </p>
      <p class="mt-1 text-xs text-text-secondary">平均延迟</p>
    </div>
    <div class="bg-bg-secondary p-4 text-center">
      <p class="text-2xl font-medium {summary.todayFailures > 0 ? 'text-failure' : 'text-success'}">{summary.todayFailures}</p>
      <p class="mt-1 text-xs text-text-secondary">今日故障次数</p>
    </div>
    <div class="bg-bg-secondary p-4 text-center">
      <p class="text-2xl font-medium text-success">{summary.maxConsecutiveDays}天</p>
      <p class="mt-1 text-xs text-text-secondary">最长连续运行</p>
    </div>
  </div>

  <div class="border-t border-gray-100 bg-gray-50 p-4 pl-7 md:pl-10 md:pr-10">
    <div class="flex flex-col gap-3 text-sm md:flex-row md:items-center md:justify-between">
      <div class="flex min-h-5 items-center gap-2">
        <div class="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {#if lastFailureTime}
            <svg class="h-4 w-4 text-failure" aria-hidden="true"><use href="/icons.svg#icon-failure"></use></svg>
          {:else}
            <svg class="h-4 w-4 text-success" aria-hidden="true"><use href="/icons.svg#icon-success"></use></svg>
          {/if}
        </div>
        <span class="text-text-secondary">
          {#if lastFailureTime}
            <span>最近故障: <span class="text-text-primary">{lastFailureTime}</span></span>
          {:else}
            <span class="text-success">近期无故障记录</span>
          {/if}
        </span>
      </div>

      <div class="flex min-h-5 flex-wrap items-center gap-4">
        <span class="text-text-secondary">{refreshHint}</span>
        {#if dataSourceText}
          <span class="text-text-secondary" data-testid="data-source">{dataSourceText}</span>
        {/if}
      </div>
    </div>
  </div>
</section>
