import { createQueue } from './connection.js';
import type { ISagaEnqueuer } from '../../domain/services/order-service.js';
import { logger } from '../observability/logger.js';

const SAGA_QUEUE_NAME = 'saga-execution';

/**
 * BullMQ-backed ISagaEnqueuer implementation.
 *
 * Enqueues saga execution jobs into a dedicated BullMQ queue.
 * The saga worker processes these jobs asynchronously, providing:
 *   - Crash recovery: if the process dies, BullMQ retries the job
 *   - Retry with backoff: failed sagas are retried with exponential backoff
 *   - DLQ: permanently failed sagas land in the DLQ for admin intervention
 *   - Observability: job state is visible via the admin API
 *
 * The queue instance is cached as a singleton for connection efficiency.
 */
export class BullMQSagaEnqueuer implements ISagaEnqueuer {
  private readonly queue = createQueue(SAGA_QUEUE_NAME);

  async enqueue(context: {
    orderId: string;
    customerId: string;
    items: ReadonlyArray<{ sku: string; quantity: number }>;
    totalAmount: { amount: string; currency: string };
    paymentToken: string;
  }): Promise<string> {
    const job = await this.queue.add(
      'execute-saga',
      context,
      {
        jobId: `saga-${context.orderId}`, // Deduplicate by orderId
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    );

    logger.info(
      { jobId: job.id, orderId: context.orderId, queue: SAGA_QUEUE_NAME },
      'Saga execution job enqueued',
    );

    return job.id ?? context.orderId;
  }
}
