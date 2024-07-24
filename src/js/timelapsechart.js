import { maxHour } from '../index.js';

/**
 * 异步函数：更新图表数据
 * 
 * 本函数用于根据给定的日志数据更新图表。它首先确定当前小时的开始时间，
 * 然后从日志数据中筛选出该小时内的数据点，最后更新图表以反映这些数据。
 * 
 * @param {HTMLElement} el - 图表元素的引用，用于更新图表的DOM元素。
 * @param {Array} logData - 包含日志数据的数组，每个元素代表一个数据点。
 * @returns {void}
 */

export async function updateChart(el, logData) {
  try {
    const now = new Date();
    const startOfCurrentHour = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0,
      0
    );

    const twelveHoursAgo = new Date(startOfCurrentHour.getTime() - maxHour * 60 * 60 * 1000);

    // console.log(twelveHoursAgo)

    // 分割日志数据为单独的条目。
    const logEntries = logData.split(/\r\n|\n/).filter(entry => entry !== '');

    // 初始化小时数据对象。
    const hourlyData = {};

    // 遍历日志条目，提取并汇总每小时的数据。
    logEntries.forEach((entry) => {
      const parts = entry.split(", ").filter(entry => entry !== 'null');
      if (parts.length >= 3) {
        const timeStr = parts[0];
        const delay = parseInt(parts[2], 10);
        const date = new Date(timeStr);

        // 如果日期在过去12小时内，累加从现在到过去12小时的数据。
        if (date >= twelveHoursAgo && date <= now) {
          const hourKey = `${date.getHours()}:00`;
          if (!hourlyData[hourKey]) {
            hourlyData[hourKey] = { total: 0, count: 0, values: [] };
          }
          hourlyData[hourKey].total += delay;
          hourlyData[hourKey].count++;
          hourlyData[hourKey].values.push(delay);
        }
      }
    });

    // 初始化图表标签、平均数据和中位数数据数组。
    const labels = [];
    const averageData = [];
    const medianData = [];

    // 遍历过去12小时，计算每小时的平均值和中位数。
    let currentHour = new Date(startOfCurrentHour);
    for (let i = 0; i <= maxHour; i++) {
      const hourKey = `${currentHour.getHours()}:00`;
      const average =
        hourlyData[hourKey] && hourlyData[hourKey].count > 0
          ? hourlyData[hourKey].total / hourlyData[hourKey].count
          : null;
      const median =
        hourlyData[hourKey] && hourlyData[hourKey].values.length > 0
          ? calculateMedian(hourlyData[hourKey].values)
          : null;
      labels.push(hourKey);
      averageData.push(average);
      medianData.push(median);
      currentHour.setHours(currentHour.getHours() - 1);
    }

    // 反转数组，因为Chart.js默认从最新的小时开始绘制。
    labels.reverse();
    averageData.reverse();
    medianData.reverse();

    // 合并平均数和中位数，过滤掉NaN值,然后根据最大值来决定是否设置y轴的最大值
    const combinedData = averageData.concat(medianData).filter(value => !isNaN(value));
    let yMaxConfig = {};
    if (combinedData.length === 0 || Math.max(...combinedData) <= 14) {
      yMaxConfig.max = 15;
    }


    // 获取图表上下文并创建新的Chart实例。
    const ctx = el.getContext("2d");
    const skipped = (ctx, value) => ctx.p0.skip || ctx.p1.skip ? value : undefined;
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "平均值",
            data: averageData,
            fill: false,
            borderColor: "#4bc0c0",
            tension: 0.4,
            segment: {
              borderDash: ctx => skipped(ctx, [4, 6]),
            },
            spanGaps: true
          },
          {
            label: "中位数",
            data: medianData,
            fill: false,
            borderColor: "#ff6384",
            tension: 0.4,
            segment: {
              borderDash: ctx => skipped(ctx, [4, 6]),
            },
            spanGaps: true
          },
        ],
      },
      options: {
        plugins: {
          legend: {
            display: false, // 显示图例
          },
        },
        scales: {
          x: {
            title: {
              display: false,
            },
            ticks: {
              autoSkip: true, // 确保每个点都被标记
              maxRotation: 65, // 设置最大旋转角度
              minRotation: 0, // 设置最小旋转角度
            },
          },
          y: {
            title: {
              display: false,
            },
            beginAtZero: true,
            ...yMaxConfig, // 使用yMaxConfig来有条件地设置max
          },
        },
      },
    });
  } catch (error) {
    console.error("Error fetching or processing logs:", error);
  }
}

function calculateMedian(values) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[middle - 1] + values[middle]) / 2;
  } else {
    return values[middle];
  }
}