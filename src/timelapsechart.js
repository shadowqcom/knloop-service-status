async function updateChart(el, logData) {
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

    const twelveHoursAgo = new Date(startOfCurrentHour.getTime() - 11 * 60 * 60 * 1000);

    // 分割日志数据为单独的条目。
    const logEntries = logData.split(/\r\n|\n/).filter(entry => entry !== '');

    // 初始化小时数据对象。
    const hourlyData = {};

    // 遍历日志条目，提取并汇总每小时的数据。
    logEntries.forEach((entry) => {
      const parts = entry.split(", ");
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
    for (let i = 0; i < 12; i++) {
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
    new Chart(ctx, {
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
          },
          {
            label: "中位数",
            data: medianData,
            fill: false,
            borderColor: "#ff6384",
            tension: 0.4,
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

async function getLogData(el, name) {
  const response = await fetch(`./logs/${name}.log`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const logData = await response.text();
  updateChart(el, logData);
}
