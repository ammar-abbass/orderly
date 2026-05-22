import { setInterval } from 'timers/promises';
import { OutboxRepository } from '../../domain/repositories/outbox-repository.js';
import { createQueue } from '../../infrastructure/queue/connection.js';
import { getConfig } from '../../config.js';
import { logger } from '../../infrastructure/observability/logger.js';
import { metrics } from '../../infrastructure/observability/metrics.js';

/**
 * OutboxProcessor — polls outbox_events and publishes to BullMQ queues.
 *
 * At-least-once semantics:
 *   - Uses FOR UPDATE SKIP LOCKED to prevent double-processing by multiple instances.
 *   - Marks event PUBLISHED only after successful BullMQ enqueue.
 *   - On failure: increments retry_count, leaves status PENDING for the next poll.
 *   - After outboxMaxRetries: marks FAILED and emits error log + metric.
 *
 * Queue routing:
 *   The target queue is encoded in the event payload as `payload.queue`.
 *   This avoids the fragile string-prefix routing that was present in v1.
 *   If no queue is specified, defaults to 'webhook-delivery'.
 */
export class OutboxProcessor {
  private running = false;
  private abortController: AbortController | null = null;
  private readonly queues = new Map<string, ReturnType<typeof createQueue>>();

  constructor(private readonly outboxRepo: OutboxRepository) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();
    const config = getConfig();

    logger.info({ pollIntervalMs: config.outboxPollIntervalMs }, 'Outbox processor started');

    try {
      for await (const _ of setInterval(config.outboxPollIntervalMs, undefined, {
        signal: this.abortController.signal,
      })) {
        if (!this.running) break;
        await this.processBatch().catch((err: unknown) => {
          logger.error({ err }, 'Outbox batch processing error');
        });
      }
    } catch (err) {
      // AbortError is expected on graceful shutdown
      if ((err as NodeJS.ErrnoException).code !== 'ABORT_ERR') {
        logger.error({ err }, 'Outbox processor loop crashed');
        throw err;
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    for (const queue of this.queues.values()) {
      await queue.close().catch((err: unknown) =>
        logger.error({ err }, 'Failed to close queue during shutdown')
      );
    }
    this.queues.clear();
    logger.info('Outbox processor stopped');
  }

  private getQueue(queueName: string) {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = createQueue(queueName);
      this.queues.set(queueName, queue);
    }
    return queue;
  }

  private async processBatch(): Promise<void> {
    const config = getConfig();
    const events = await this.outboxRepo.getPending(100);
    if (events.length === 0) return;

    logger.debug({ count: events.length }, 'Processing outbox batch');

    for (const event of events) {
      if (event.retryCount >= config.outboxMaxRetries) {
        logger.error(
          { eventId: event.id, eventType: event.eventType, retries: event.retryCount },
          'Outbox event exceeded max retries — marking FAILED',
        );
        await this.outboxRepo.markFailed(event.id, false);
        metrics.increment('outbox.exceeded_retries', { eventType: event.eventType });
        continue;
      }

      try {
        // Queue name is encoded in the payload — no fragile string-prefix routing
        const queueName =
          typeof event.payload['queue'] === 'string' ? event.payload['queue'] : 'webhook-delivery';

        const queue = this.getQueue(queueName);
        await queue.add(
          event.eventType,
          {
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            payload: event.payload,
            headers: event.headers,
          },
          { jobId: event.id }, // Idempotent enqueue — duplicate event IDs are deduped
        );

        await this.outboxRepo.markPublished(event.id);
        metrics.increment('outbox.published', { eventType: event.eventType });
        logger.debug({ eventId: event.id, eventType: event.eventType, queueName }, 'Outbox event published');
      } catch (err) {
        logger.error({ err, eventId: event.id, eventType: event.eventType }, 'Failed to publish outbox event');
        await this.outboxRepo.resetForRetry(event.id);
        metrics.increment('outbox.retry', { eventType: event.eventType });
      }
    }
  }
}
