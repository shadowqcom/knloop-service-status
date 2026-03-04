export function parseBeijingTime(timeStr) {
  if (!timeStr) return null;
  
  if (timeStr.includes('Z')) {
    return new Date(timeStr);
  }
  
  const normalized = timeStr.replace(' ', 'T');
  return new Date(normalized + '+08:00');
}

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

export function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export const STATUS_MAP = {
  success: '正常',
  failure: '故障',
  partial: '部分故障',
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
