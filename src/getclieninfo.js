/**
 * 当文档加载完成时，异步获取并处理客户端追踪数据。
 * 该函数主要从一个特定的URL获取客户端信息，并使用这些信息替换文档中特定数据占位符的值。
 * 使用fetch API进行异步请求以避免阻塞文档加载。
 */
export async function getclieninfo() {
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

            // 选择所有需要替换的元素
            const elements = document.querySelectorAll('[data-trace-placeholder]');

            // 遍历元素并替换占位符
            elements.forEach(element => {
                const placeholder = element.getAttribute('data-trace-placeholder');
                const prefix = element.textContent.split('$' + placeholder)[0]; // 分离描述性文本和占位符
                const suffix = element.textContent.split('$' + placeholder)[1]; // 分离占位符后的文本
                if (traceData[placeholder]) {
                    element.textContent = prefix + traceData[placeholder] + suffix; // 将描述性文本、值和后续文本合并
                }
            });

        } catch (error) {
            console.error("获取客户端信息失败:", error);
        }
    });
}
