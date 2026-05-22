import type { Job } from 'bullmq';
import type { SagaOrchestrator, SagaContext } from '../../../domain/services/saga-orchestrator.js';
import { logger } from '../../observability/logger.js';

/**
 * BullMQ saga worker processor.
 *
 * Processes saga-execution jobs enqueued by OrderService after order creation.
 * The saga orchestrator is injected as a singleton from the composition root,
 * preserving circuit breaker state and connection pools across jobs.
 *
 * If the saga fails or the process crashes mid-execution, BullMQ's retry
 * mechanism will re-attempt. The saga orchestrator is idempotent — it reads
 * persisted step state from the DB to determine what has already completed.
 */
export function createSagaWorkerProcessor(
  sagaOrchestrator: SagaOrchestrator,
) {
  return async function processSagaJob(job: Job<SagaContext>): Promise<void> {
    const context = job.data;
    logger.info(
      { jobId: job.id, orderId: context.orderId },
      'Processing saga execution job',
    );

    try {
      const result = await sagaOrchestrator.startSaga(context);
      logger.info(
        { jobId: job.id, orderId: context.orderId, sagaId: result.id, status: result.status },
        'Saga execution completed',
      );
    } catch (err) {
      logger.error(
        { err, jobId: job.id, orderId: context.orderId },
        'Saga execution failed — will retry if attempts remain',
      );
      throw err; // Re-throw to trigger BullMQ retry
    }
  };
}
