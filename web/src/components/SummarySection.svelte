<script lang="ts">
  import type { StatusKind, Summary } from '../lib/status';
  import { STATUS_TEXT_CLASS } from '../lib/status';

  interface Props {
    summary: Summary;
    overallStatus: StatusKind;
    lastUpdateText: string;
    refreshing: boolean;
    onRefresh: () => void;
  }

  let {
    summary,
    overallStatus,
    lastUpdateText,
    refreshing,
    onRefresh
  }: Props = $props();

  const iconClass = $derived(STATUS_TEXT_CLASS[overallStatus]);
  const windowChecksText = $derived(formatCompactCount(summary.windowChecks));

  const circleClass = $derived({
    success: 'bg-success/15',
    failure: 'bg-failure/15',
    partial: 'bg-partial/15',
    nodata: 'bg-nodata/20'
  }[overallStatus]);

  function formatCompactCount(value: number): string {
    if (value >= 10000) {
      const tenThousands = value / 10000;
      const digits = tenThousands >= 10 ? 0 : 1;
      return tenThousands.toFixed(digits).replace(/\.0$/, '') + '万';
    }
    return value.toLocaleString('zh-CN');
  }
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

  <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
    <div class="bg-bg-secondary p-4 text-center">
      <p class="text-2xl font-medium text-success" data-testid="total-success-rate">{summary.totalSuccessRate}%</p>
      <p class="mt-1 text-xs text-text-secondary">总成功率</p>
    </div>
    <div class="bg-bg-secondary p-4 text-center">
      <p class="text-2xl font-medium text-failure" data-testid="total-failures" title="非成功检查次数（含异常 + 故障）">{summary.totalFailures}</p>
      <p class="mt-1 text-xs text-text-secondary">总故障次数</p>
    </div>
    <div class="bg-bg-secondary p-4 text-center">
      <p class="text-2xl font-medium text-text-primary" data-testid="window-checks" title={"60 天窗口内总检查次数：" + summary.windowChecks.toLocaleString('zh-CN')}>{windowChecksText}</p>
      <p class="mt-1 text-xs text-text-secondary">窗口检查次数</p>
    </div>
    <div class="bg-bg-secondary p-4 text-center">
      <p class="text-2xl font-medium {summary.longestOutageDays > 0 ? 'text-failure' : 'text-text-primary'}" data-testid="longest-outage" title="连续全天故障的最长天数">{summary.longestOutageDays}天</p>
      <p class="mt-1 text-xs text-text-secondary">最长连续中断</p>
    </div>
    <div class="bg-bg-secondary p-4 text-center max-sm:col-span-2">
      <p class="text-2xl font-medium text-success">{summary.maxConsecutiveDays}天</p>
      <p class="mt-1 text-xs text-text-secondary">最长连续运行</p>
    </div>
  </div>

</section>
