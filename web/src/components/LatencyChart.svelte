<script lang="ts">
  import { untrack } from 'svelte';
  import Chart from 'chart.js/auto';
  import type { ChartPayload } from '../lib/status';

  interface Props {
    payload: ChartPayload;
  }

  let { payload }: Props = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let chart = $state<Chart | null>(null);

  const AXIS_COLOR = '#7c7c7c';
  const FONT = { family: 'Maple Mono, system-ui, sans-serif', size: 11 };

  function skipped(context: any, value: number[]): number[] | undefined {
    return context.p0.skip || context.p1.skip ? value : undefined;
  }

  function buildConfig(p: ChartPayload): any {
    return {
      type: 'line',
      data: {
        labels: [...p.labels],
        datasets: [
          {
            label: '中位数',
            data: [...p.median],
            borderColor: '#3b82f6',
            backgroundColor: '#3b82f6',
            fill: false,
            tension: 0.4,
            spanGaps: true,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#3b82f6',
            pointBorderWidth: 2,
            borderWidth: 2,
            segment: { borderDash: (context: any) => skipped(context, [4, 6]) }
          },
          {
            label: 'P95',
            data: [...p.p95],
            borderColor: '#f59e0b',
            backgroundColor: '#f59e0b',
            fill: false,
            tension: 0.4,
            spanGaps: true,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#f59e0b',
            pointBorderWidth: 2,
            borderWidth: 2,
            segment: { borderDash: (context: any) => skipped(context, [4, 6]) }
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context: any) => (context.dataset.label || '') + ': ' + (context.parsed.y ?? '-') + 'ms'
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { autoSkip: true, maxRotation: 65, minRotation: 0, color: AXIS_COLOR, font: FONT }
          },
          y: {
            beginAtZero: true,
            max: p.yMax ?? undefined,
            grid: { color: 'rgba(32, 43, 54, 0.06)' },
            ticks: { color: AXIS_COLOR, font: FONT }
          }
        }
      }
    };
  }

  function applyPayload(instance: Chart, p: ChartPayload): void {
    instance.data.labels = [...p.labels];
    const datasets = instance.data.datasets;
    if (datasets[0]) datasets[0].data = [...p.median];
    if (datasets[1]) datasets[1].data = [...p.p95];
    const scales = instance.options.scales;
    if (scales && scales.y) scales.y.max = p.yMax ?? undefined;
    instance.update('none');
  }

  $effect(() => {
    if (!canvas) return;
    const instance = new Chart(canvas, buildConfig(untrack(() => payload)));
    chart = instance;
    return () => {
      instance.destroy();
      chart = null;
    };
  });

  $effect(() => {
    const next = payload;
    if (!chart) return;
    applyPayload(chart, next);
  });
</script>

<div class="mt-2 h-48" role="img" aria-label="最近延迟趋势（中位数 / P95）">
  <canvas bind:this={canvas} data-testid="latency-chart"></canvas>
</div>
