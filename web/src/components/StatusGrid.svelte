<script lang="ts">
  import type { DailyPoint } from '../lib/status';
  import { STATUS_BG_CLASS, formatStatusPoint } from '../lib/status';

  interface Props {
    points: DailyPoint[];
    selectedDate?: string | null;
    onhover?: (point: DailyPoint | null) => void;
    onselect?: (point: DailyPoint) => void;
  }

  let { points, selectedDate = null, onhover, onselect }: Props = $props();

  let scroller = $state<HTMLDivElement | null>(null);

  // 与旧页面一致：移动端首屏把 60 块横向滚动到最右（最近日期）
  $effect(() => {
    if (!scroller) return;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    scroller.scrollLeft = scroller.scrollWidth;
  });
</script>

<div
  class="overflow-x-auto overflow-y-hidden py-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden"
  bind:this={scroller}
  data-testid="status-scroll"
>
  <div
    class="grid grid-cols-[repeat(60,minmax(0,1fr))] gap-[2px] max-md:min-w-max max-md:grid-cols-[repeat(60,10px)]"
    data-testid="status-grid"
  >
    {#each points as point (point.date)}
      <button
        type="button"
        data-testid="status-block"
        data-date={point.date}
        data-status={point.status}
        title={formatStatusPoint(point)}
        aria-label={formatStatusPoint(point)}
        class="h-10 w-full cursor-pointer rounded-[2px] transition-transform duration-150 hover:scale-y-125 {STATUS_BG_CLASS[point.status]} {selectedDate === point.date ? 'scale-y-125 ring-2 ring-text-primary ring-offset-1' : ''}"
        onmouseenter={() => onhover?.(point)}
        onmouseleave={() => onhover?.(null)}
        onclick={() => onselect?.(point)}
      ></button>
    {/each}
  </div>
</div>
