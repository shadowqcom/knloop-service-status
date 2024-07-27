/**
 * 当文档加载完成时，异步获取并处理客户端追踪数据。
 * 该函数主要从一个特定的URL获取客户端信息，并使用这些信息替换文档中特定数据占位符的值。
 * 使用fetch API进行异步请求以避免阻塞文档加载。
 */
export async function getclieninfo() {
  // 创建数据对象
  let data = {
    ip: '0.0.0.0',
    loc: 'shenzhen',
    ts: new Date().toLocaleString(),
    uag: navigator.userAgent
  };

  try {
    let clientInfoDiv = document.getElementById('clientInfo');
    let spans = clientInfoDiv.getElementsByTagName('span');

    for (let span of spans) {
      let id = span.id;
      if (data.hasOwnProperty(id)) {
        let originalText = span.innerHTML;
        let regex = new RegExp(`\\$${id}`, 'g');
        span.innerHTML = originalText.replace(regex, data[id]);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}