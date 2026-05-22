import pino from 'pino';
import { getConfig } from '../../config.js';

export function createLogger(serviceName: string): pino.Logger {
  const config = getConfig();

  return pino({
    level: config.logLevel,
    base: { service: serviceName, pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({ pid: bindings['pid'], host: bindings['hostname'] }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'password',
        'secret',
        'token',
        'paymentToken',
        'cardNumber',
      ],
      remove: true,
    },
    ...(config.nodeEnv === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

export const logger = createLogger('orderly');
