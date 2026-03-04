import { getConfig, onConfigLoaded } from './configLoader.js';
import { parseBeijingTime } from './utils.js';

let maxHour = getConfig().maxHour;

onConfigLoaded(config => {
  maxHour = config.maxHour;
});

const chartInstances = new WeakMap();

export async function updateChart(el, logData, selectedDay = null) {
  try {
    const logEntries = logData.split(/\r\n|\n/).filter((entry) => entry !== "");
    const hourlyData = new Map();
    const now = new Date();

    logEntries.forEach((entry) => {
      const parsed = parseLogEntry(entry);
      if (!parsed || parsed.latency === null) return;
      
      const date = parseBeijingTime(parsed.time);
      if (!date || isNaN(date.getTime())) return;
      
      const hourKey = formatHourKey(date);
      if (!hourlyData.has(hourKey)) {
        hourlyData.set(hourKey, { total: 0, count: 0, values: [] });
      }
      hourlyData.get(hourKey).total += parsed.latency;
      hourlyData.get(hourKey).count++;
      hourlyData.get(hourKey).values.push(parsed.latency);
    });

    const labels = [];
    const averageData = [];
    const medianData = [];

    if (selectedDay) {
      const selectedDate = new Date(selectedDay);
      const isToday = selectedDate.toDateString() === now.toDateString();
      const endHour = isToday ? now.getHours() : 23;
      
      for (let h = 0; h <= endHour; h++) {
        const hourDate = new Date(selectedDate);
        hourDate.setHours(h, 0, 0, 0);
        const hourKey = formatHourKey(hourDate);
        const hourlyDatum = hourlyData.get(hourKey) || { total: 0, count: 0, values: [] };

        const average = hourlyDatum.count > 0 ? hourlyDatum.total / hourlyDatum.count : null;
        const median = hourlyDatum.values.length > 0 ? calculateMedian(hourlyDatum.values) : null;

        labels.push(`${h.toString().padStart(2, '0')}:00`);
        averageData.push(average);
        medianData.push(median);
      }
    } else {
      const endHour = new Date(now);
      endHour.setMinutes(0, 0, 0);

      for (let i = 0; i <= maxHour; i++) {
        const currentHour = new Date(endHour.getTime() - (i * 60 * 60 * 1000));
        const hourKey = formatHourKey(currentHour);
        const hourlyDatum = hourlyData.get(hourKey) || { total: 0, count: 0, values: [] };

        const average = hourlyDatum.count > 0 ? hourlyDatum.total / hourlyDatum.count : null;
        const median = hourlyDatum.values.length > 0 ? calculateMedian(hourlyDatum.values) : null;

        const hours = currentHour.getHours();
        labels.unshift(`${hours.toString().padStart(2, '0')}:00`);
        averageData.unshift(average);
        medianData.unshift(median);
      }
    }

    const combinedData = averageData.concat(medianData).filter((value) => value !== null && !isNaN(value));
    let yMaxConfig = {};
    if (combinedData.length === 0 || Math.max(...combinedData) <= 14) {
      yMaxConfig.max = 15;
    }

    const ctx = el.getContext("2d");

    let chartInstance = chartInstances.get(el);
    if (!chartInstance) {
      chartInstance = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "平均值",
              data: averageData,
              fill: false,
              borderColor: "#3b82f6",
              tension: 0.4,
              segment: { borderDash: (ctx) => skipped(ctx, [4, 6]) },
              spanGaps: true,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: "中位数",
              data: medianData,
              fill: false,
              borderColor: "#8b5cf6",
              tension: 0.4,
              segment: { borderDash: (ctx) => skipped(ctx, [4, 6]) },
              spanGaps: true,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              title: { display: false },
              ticks: { 
                autoSkip: true, 
                maxRotation: 65, 
                minRotation: 0
              },
            },
            y: {
              title: { display: false },
              beginAtZero: true,
              ...yMaxConfig,
            },
          },
        },
      });
      chartInstances.set(el, chartInstance);
    } else {
      chartInstance.data.labels = labels;
      chartInstance.data.datasets[0].data = averageData;
      chartInstance.data.datasets[1].data = medianData;
      chartInstance.options.scales.y = {
        title: { display: false },
        beginAtZero: true,
        ...yMaxConfig,
      };
      chartInstance.update();
    }
  } catch (error) {
    console.debug('[updateChart] Chart render error:', error.message);
  }
}

function formatHourKey(date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:00`;
}

function parseLogEntry(entry) {
  try {
    const data = JSON.parse(entry);
    return {
      time: data.time || data.timestamp,
      status: data.status,
      latency: typeof data.latency === 'number' ? data.latency : 
               typeof data.responseTime === 'number' ? data.responseTime : null
    };
  } catch (e) {
    console.debug('[parseLogEntry] Parse error:', e.message);
    return null;
  }
}

function calculateMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  } else {
    return sorted[middle];
  }
}

function skipped(ctx, value) {
  return ctx.p0.skip || ctx.p1.skip ? value : undefined;
}
