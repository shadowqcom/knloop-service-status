// 统一读取并处理所有.log文件，供其他地方使用。
export async function reslogs(logspath, key) {
    const response = await fetch(logspath + key + "_report.log");
    return response;
}