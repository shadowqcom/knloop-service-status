document.addEventListener("DOMContentLoaded", async function () {
    try {
        const response = await fetch("https://www.cloudflare.com/cdn-cgi/trace");
        const data = await response.text();

        const lines = data.split("\n");
        const traceData = {};
        lines.forEach((line) => {
            const [key, value] = line.split("=");
            if (key && value) {
                traceData[key] = value.trim();
            }
        });

        // 选择所有包含占位符的元素
        const elements = document.querySelectorAll('.clientInfo');

        // 遍历元素并替换占位符
        elements.forEach(element => {
            let textContent = element.textContent;

            // 使用正则表达式替换占位符
            Object.keys(traceData).forEach(key => {
                const regex = new RegExp(`\\$${key}`, 'g');
                textContent = textContent.replace(regex, traceData[key]);
            });

            // 更新元素的文本内容
            element.textContent = textContent;
        });

    } catch (error) {
        console.error("获取客户端信息失败:", error);
    }
});
