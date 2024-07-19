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
    const oneDayAgo = new Date(
      startOfCurrentHour.getTime() - 24 * 60 * 60 * 1000
    );

    // 优化：提取计算每小时数据的逻辑到单独的函数中
    const hourlyData = calculateHourlyData(logData, oneDayAgo, startOfCurrentHour);

    // 创建一个完整的时间序列，从当前时间的前 12 小时到当前时间的整点
    const labels = [];
    const data = [];
    let currentHour = new Date(startOfCurrentHour);
    for (let i = 0; i < 12; i++) {
      const hourKey = `${currentHour.getHours()}:00`;
      const average =
        hourlyData[hourKey] && hourlyData[hourKey].count > 0
        ? hourlyData[hourKey].total / hourlyData[hourKey].count
         : NaN;
      labels.push(hourKey);
      data.push(average);
      currentHour.setHours(currentHour.getHours() - 1);
    }

    // 反转数组以正确显示时间顺序
    labels.reverse();
    data.reverse();

    // 过滤掉 data 数组中的 NaN 值, 然后根据数据集中的最大值来决定是否设置 y 轴的最大值
    const validData = data.filter(value =>!isNaN(value));
    let yMaxConfig = {};
    if (validData.length === 0 || Math.max(...validData) <= 10) {
      yMaxConfig.max = 10;
    }

    const ctx = el.getContext("2d");
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data,
            fill: false,
            borderColor: "#4bc0c0",
            tension: 0.4,
          },
        ],
      },
      options: {
        plugins: {
          legend: {
            display: false, // 设置为 false 以隐藏图例
          },
        },
        scales: {
          x: {
            title: {
              display: false,
            },
            ticks: {
              autoSkip: false, // 确保每个点都被标记
              maxRotation: 65, // 设置最大旋转角度
              minRotation: 0, // 设置最小旋转角度
            },
          },
          y: {
            title: {
              display: false,
            },
            beginAtZero: true,
          ...yMaxConfig, // 使用 yMaxConfig 来有条件地设置 max
          },
        },
      },
    });
  } catch (error) {
    console.error("Error fetching or processing logs:", error);
  }
}

function calculateHourlyData(logData, oneDayAgo, startOfCurrentHour) {
  const logEntries = logData.split("\n");
  const hourlyData = {};
  logEntries.forEach((entry) => {
    const parts = entry.split(", ");
    if (parts.length >= 3) {
      const timeStr = parts[0];
      const delay = parseInt(parts[2], 10);
      const date = new Date(timeStr);
      if (date >= oneDayAgo && date <= startOfCurrentHour) {
        const hourKey = `${date.getHours()}:00`;
        if (!hourlyData[hourKey]) {
          hourlyData[hourKey] = { total: 0, count: 0 };
        }
        hourlyData[hourKey].total += delay;
        hourlyData[hourKey].count++;
      }
    }
  });
  return hourlyData;
}

async function getLogData(el, name) {
  try {
    const response = await fetch(`./logs/${name}.log`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const logData = await response.text();
    updateChart(el, logData);
  } catch (error) {
    console.error("Error fetching logs:", error);
  }
}