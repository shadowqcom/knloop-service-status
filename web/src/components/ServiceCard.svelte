<script lang="ts">
  import type { DailyPoint, ServiceViewModel } from '../lib/status';
  import {
    STATUS_TEXT_CLASS,
    formatAvgLatencyText,
    formatStatusPoint,
    selectHourlyWindow
  } from '../lib/status';
  import StatusGrid from './StatusGrid.svelte';
  import LatencyChart from './LatencyChart.svelte';

  interface Props {
    service: ServiceViewModel;
    selectedDay: string | null;
    onSelectDay: (date: string | null) => void;
  }

  let { service, selectedDay, onSelectDay }: Props = $props();

  let hovered = $state<DailyPoint | null>(null);

  const chartPayload = $derived(selectHourlyWindow(service, selectedDay, { now: Date.now(), maxHour: 12 }));
  const statusClass = $derived(STATUS_TEXT_CLASS[service.status]);
  const successRateText = $derived(service.successRate === null ? '--' : service.successRate.toFixed(2));
  const errorRateText = $derived(service.errorRate === null ? '--' : service.errorRate.toFixed(2));

  function handleSelect(point: DailyPoint): void {
    onSelectDay(selectedDay === point.date ? null : point.date);
  }
</script>

<article class="p-6" data-testid="service-card" data-service={service.key}>
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-2">
      <svg class="h-5 w-5 flex-shrink-0 {statusClass}" aria-hidden="true">
        <use href={'/icons.svg#icon-' + service.status}></use>
      </svg>
      <a
        href={service.url}
        target="_blank"
        rel="nofollow"
        class="truncate text-lg font-normal text-text-primary transition-colors hover:text-success"
      >{service.title}</a>
    </div>
    <span class="text-xs text-text-secondary" data-testid="service-rates">成功率 {successRateText}% · 错误率 {errorRateText}%</span>
  </div>

  <StatusGrid
    points={service.statusPoints}
    selectedDate={selectedDay}
    onhover={(point) => { hovered = point; }}
    onselect={handleSelect}
  />

  <div class="mt-2 flex flex-col gap-1 px-1 text-xs text-text-secondary">
    <div class="flex items-center justify-between gap-4">
      <span class="shrink-0">响应时间(ms)</span>
      <span class="truncate text-right" data-testid="latency-hint">
        {hovered ? formatStatusPoint(hovered) : formatAvgLatencyText(service, selectedDay)}
      </span>
    </div>
    {#if selectedDay}
      <div class="flex items-center gap-1 text-partial" data-testid="selected-day">
        <span>{selectedDay} 全天数据</span>
        <button
          type="button"
          class="cursor-pointer px-1 text-base hover:text-failure"
          aria-label="清除选中日期"
          onclick={() => onSelectDay(null)}
        >✕</button>
      </div>
    {/if}
  </div>

  <LatencyChart payload={chartPayload} />
</article>
