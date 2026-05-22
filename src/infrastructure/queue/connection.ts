import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { getConfig } from '../../config.js';

let queueConnection: Redis | null = null;

export function getQueueConnection(): Redis {
  if (queueConnection) return queueConnection;

  const config = getConfig();
  queueConnection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  return queueConnection;
}

export function createQueue(name: string): Queue {
  const config = getConfig();
  return new Queue(name, {
    connection: getQueueConnection(),
    prefix: config.queuePrefix,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 100,
      removeOnFail: false, // Keep all failed jobs for DLQ inspection
    },
  });
}

export function createWorker<T>(
  name: string,
  processor: (job: Job<T>) => Promise<void>,
): Worker {
  const config = getConfig();
  return new Worker(name, processor, {
    connection: getQueueConnection(),
    prefix: config.queuePrefix,
    concurrency: 50,
    stalledInterval: 30_000,
    maxStalledCount: config.queueMaxStalledCount,
  });
}

export async function closeQueueConnection(): Promise<void> {
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = null;
  }
}
