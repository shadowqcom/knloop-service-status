/**
 * 异步函数updateChart用于更新图表，显示过去12小时的延迟数据。
 * @param {HTMLElement} el - 图表容器的HTML元素。
 * @param {string} logData - 日志数据，包含时间戳和延迟信息。
 */
async function updateChart(el, logData) {
  try {
    // 获取当前时间，用于计算过去12小时的范围。
    const now = new Date();
    // 计算当前小时的开始时间。
    const startOfCurrentHour = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours()
    );

    // 计算12小时前的时间,因为有0点所以-11
    const twelveHoursAgo = new Date(startOfCurrentHour.getTime() - 11 * 60 * 60 * 1000);

    // 分割日志数据以每行作为条目。
    const logEntries = (logData.split("\r\n")).filter(entry => entry.trim() !== '');
    // console.log(logEntries)

    // 用于存储每小时的延迟数据。
    const hourlyData = {};
    logEntries.forEach((entry) => {
      try {
        const parts = entry.split(", ");
        if (parts.length >= 3) {
          const timeStr = parts[0];
          const delay = parseInt(parts[2], 10);
          const date = new Date(timeStr);

          // 确保处理跨天情况，获取最近12小时内的数据
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
      } catch (error) {
        console.error(`Error processing entry: ${entry}`, error);
      }
    });

    // 初始化用于图表的标签、平均值数据和中位数数据。
    const labels = [];
    const averageData = [];
    const medianData = [];
    // 从当前小时向前遍历12小时，计算每小时的平均值和中位数。
    let currentHour = new Date(startOfCurrentHour);
    for (let i = 0; i < 12; i++) {
      const hourKey = `${currentHour.getHours()}:00`;
      const average = hourlyData[hourKey] && hourlyData[hourKey].count > 0
        ? hourlyData[hourKey].total / hourlyData[hourKey].count
        : null;
      const median = hourlyData[hourKey] && hourlyData[hourKey].values.length > 0
        ? calculateMedian(hourlyData[hourKey].values)
        : null;
      labels.push(hourKey);
      averageData.push(average);
      medianData.push(median);
      currentHour.setHours(currentHour.getHours() - 1);
    }

    // 反转数组，因为Chart.js默认从最近的时间开始绘制。
    labels.reverse();
    averageData.reverse();
    medianData.reverse();

    // 根据数据设置y轴的最大值。
    const validAverageData = averageData.filter(value => !isNaN(value));
    const validMedianData = medianData.filter(value => !isNaN(value));
    const combinedData = validAverageData.concat(validMedianData);
    let yMaxConfig = {};
    if (validAverageData.length === 0 || Math.max(...combinedData) <= 14) {
      yMaxConfig.max = 15;
    }

    // 创建图表。
    const ctx = el.getContext("2d");
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
            display: false,
          },
        },
        scales: {
          x: {
            title: {
              display: false,
            },
            ticks: {
              autoSkip: true,
              maxRotation: 65,
              minRotation: 0,
            },
          },
          y: {
            title: {
              display: false,
            },
            beginAtZero: true,
            ...yMaxConfig,
          },
        },
      },
    });
  } catch (error) {
    console.error("Error fetching or processing logs:", error);
  }
}

/**
 * 计算给定值数组的中位数。
 * @param {number[]} values - 需要计算中位数的数值数组。
 * @return {number} - 数组的中位数。
 */
function calculateMedian(values) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[middle - 1] + values[middle]) / 2;
  } else {
    return values[middle];
  }
}

/**
 * 异步函数getLogData用于获取日志数据并更新图表。
 * @param {HTMLElement} el - 图表容器的HTML元素。
 * @param {string} name - 日志文件名。
 */
async function getLogData(el, name) {
  const response = await fetch(`./logs/${name}.log`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const logData = await response.text();
  // 使用获取的日志数据更新图表。
  updateChart(el, logData);
}