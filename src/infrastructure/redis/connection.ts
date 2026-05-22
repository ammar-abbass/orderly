import { Redis } from 'ioredis';
import { getConfig } from '../../config.js';
import { logger } from '../observability/logger.js';

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (redisInstance) return redisInstance;

  const config = getConfig();
  redisInstance = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  redisInstance.on('error', (err: Error) => {
    // Log but don't crash — graceful degradation is documented in SPEC §13.4
    logger.error({ err }, 'Redis connection error');
  });

  return redisInstance;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
