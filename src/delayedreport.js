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

    // 创建一个完整的时间序列，从当前时间的前12小时到当前时间的整点
    const labels = [];
    const data = [];
    let currentHour = new Date(startOfCurrentHour);
    for (let i = 0; i < 12; i++) {
      const hourKey = `${currentHour.getHours()}:00`;
      const average =
        hourlyData[hourKey] && hourlyData[hourKey].count > 0
          ? hourlyData[hourKey].total / hourlyData[hourKey].count
          : 0;
      labels.push(hourKey);
      data.push(average);
      currentHour.setHours(currentHour.getHours() - 1);
    }

    // 反转数组以正确显示时间顺序
    labels.reverse();
    data.reverse();

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
            display: false, // 设置为false以隐藏图例
          },
          title: {
            display: true,
            align: "start",
          },
        },
        scales: {
          x: {
            title: {
              display: true,
            },
            ticks: {
              autoSkip: false, // 确保每个点都被标记
              maxRotation: 65, // 设置最大旋转角度，例如45度
              minRotation: 0, // 设置最小旋转角度，默认为0
            },
          },
          y: {
            title: {
              display: true,
            },
            beginAtZero: true,
          },
        },
      },
    });
  } catch (error) {
    console.error("Error fetching or processing logs:", error);
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
