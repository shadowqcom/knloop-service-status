const ERROR_TYPES = {
  NETWORK: 'network',
  PARSE: 'parse',
  CONFIG: 'config',
  UNKNOWN: 'unknown'
};

const ERROR_MESSAGES = {
  [ERROR_TYPES.NETWORK]: '网络连接失败，请检查网络后重试',
  [ERROR_TYPES.PARSE]: '数据解析失败',
  [ERROR_TYPES.CONFIG]: '配置加载失败',
  [ERROR_TYPES.UNKNOWN]: '发生未知错误'
};

class AppError extends Error {
  constructor(type, message, originalError = null) {
    super(message || ERROR_MESSAGES[type] || ERROR_MESSAGES[ERROR_TYPES.UNKNOWN]);
    this.type = type;
    this.originalError = originalError;
    this.timestamp = new Date();
  }
}

function classifyError(error) {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return ERROR_TYPES.NETWORK;
  }
  if (error instanceof SyntaxError) {
    return ERROR_TYPES.PARSE;
  }
  if (error.message && error.message.includes('config')) {
    return ERROR_TYPES.CONFIG;
  }
  return ERROR_TYPES.UNKNOWN;
}

export function createError(type, message, originalError = null) {
  return new AppError(type, message, originalError);
}

export function handleError(error, context = '') {
  const appError = error instanceof AppError 
    ? error 
    : new AppError(classifyError(error), null, error);
  
  console.error(`[${context}]`, appError.message, appError.originalError || '');
  
  return appError;
}

export function getErrorMessage(error) {
  if (error instanceof AppError) {
    return error.message;
  }
  return ERROR_MESSAGES[ERROR_TYPES.UNKNOWN];
}

export { ERROR_TYPES, ERROR_MESSAGES, AppError };
