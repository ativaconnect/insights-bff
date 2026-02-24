type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const weights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const parseLevel = (value: string | undefined): LogLevel => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return 'info';
};

const currentLevel = parseLevel(process.env.LOG_LEVEL);

const shouldLog = (level: LogLevel): boolean => weights[level] >= weights[currentLevel];

const emit = (level: LogLevel, message: string, data?: Record<string, unknown>): void => {
  if (!shouldLog(level)) {
    return;
  }
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data ? { data } : {})
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
};

export const logger = {
  debug: (message: string, data?: Record<string, unknown>): void => emit('debug', message, data),
  info: (message: string, data?: Record<string, unknown>): void => emit('info', message, data),
  warn: (message: string, data?: Record<string, unknown>): void => emit('warn', message, data),
  error: (message: string, data?: Record<string, unknown>): void => emit('error', message, data)
};

