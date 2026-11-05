// 通用工具函数：时间解析/格式化、状态映射。
// 说明：v2 只保留页面与数据层实际用到的函数，旧的 debounce 已随 100ms 定时器一起移除。

/**
 * 解析北京时间字符串。
 * 支持：
 * - "2026-11-05 02:43:28"（旧日志格式，视为 UTC+8）
 * - "2026-11-05T02:43:28+08:00" / "...Z"（status.json 的 ISO 时间，带时区则直接解析）
 * - "2026-11-05"（纯日期，视为北京时间当天 00:00）
 * @param {string} timeStr
 * @returns {Date|null}
 */
export function parseBeijingTime(timeStr) {
  if (!timeStr) return null;
  const str = String(timeStr).trim();
  if (!str) return null;

  // 已带时区（Z 或 ±HH:MM / ±HHMM）时直接解析，避免重复拼接 +08:00
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
    const date = new Date(str);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const date = new Date(str + 'T00:00:00+08:00');
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = str.replace(' ', 'T');
  const date = new Date(normalized + '+08:00');
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 按北京时间格式化 Date。
 * @param {Date} date
 * @param {'date'|'time'|'full'} format
 */
export function formatDate(date, format = 'full') {
  if (!date) return '';

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');

  switch (format) {
    case 'date':
      return `${year}-${month}-${day}`;
    case 'time':
      return `${hour}:${minute}`;
    case 'full':
    default:
      return `${year}-${month}-${day} ${hour}:${minute}`;
  }
}

export const STATUS_MAP = {
  success: '正常',
  failure: '故障',
  partial: '异常',
  nodata: '无数据'
};

export const STATUS_COLOR_MAP = {
  success: 'text-success',
  failure: 'text-failure',
  partial: 'text-partial',
  nodata: 'text-nodata'
};

export const STATUS_BG_MAP = {
  success: 'bg-success',
  failure: 'bg-failure',
  partial: 'bg-partial',
  nodata: 'bg-nodata'
};
