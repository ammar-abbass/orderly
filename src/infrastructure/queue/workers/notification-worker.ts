import type { Job } from 'bullmq';
import type { WebhookDispatcher } from '../../../events/webhooks/webhook-dispatcher.js';
import { logger } from '../../observability/logger.js';
import { metrics } from '../../observability/metrics.js';

export interface NotificationJobData {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly headers: Record<string, unknown>;
}

export function createNotificationWorkerProcessor(dispatcher: WebhookDispatcher) {
  return async (job: Job<NotificationJobData>): Promise<void> => {
    const { eventType, aggregateId, payload } = job.data;
    logger.info({ jobId: job.id, eventType, aggregateId }, 'Processing notification job');

    try {
      await dispatcher.dispatch(eventType, aggregateId, payload);
      metrics.increment('notification.worker.succeeded', { eventType });
      logger.info({ jobId: job.id, eventType }, 'Notification job succeeded');
    } catch (err) {
      metrics.increment('notification.worker.failed', { eventType });
      logger.error({ err, jobId: job.id, eventType }, 'Notification job failed — will retry');
      throw err;
    }
  };
}
