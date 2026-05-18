import pino from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

export const logger = pino({
  level: logLevel,
  redact: {
    paths: [
      'password', 'token', 'apiKey', 'secret', 'authorization', 'cookie',
      'accessToken', 'refreshToken', 'privateKey',
      'req.headers.authorization', 'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password', '*.token', '*.apiKey', '*.secret',
    ],
    remove: true,
  },
  // Default pino emits {} for Error instances because own-enumerable props are
  // empty. Wire stdSerializers.err for both common keys so log.error({ error })
  // produces { name, message, stack, code, ... } instead of dropping context
  // (May 18 2026 prod incident: Redis rate-limit fail logged `error: {}`).
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  ...(isDevelopment ? {} : {
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  }),
  base: {
    env: process.env.NODE_ENV,
    pid: process.pid,
    ...(isProduction && { hostname: process.env.HOSTNAME }),
  },
});

export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

export const loggers = {
  middleware: createLogger({ component: 'middleware' }),
  auth: createLogger({ component: 'auth' }),
  api: createLogger({ component: 'api' }),
  gdpr: createLogger({ component: 'gdpr' }),
  security: createLogger({ component: 'security' }),
  database: createLogger({ component: 'database' }),
  cache: createLogger({ component: 'cache' }),
};

export function logError(error: Error, context?: Record<string, unknown>) {
  logger.error({ ...context, error: { name: error.name, message: error.message, stack: error.stack } }, error.message || 'An error occurred');
}

export default logger;
