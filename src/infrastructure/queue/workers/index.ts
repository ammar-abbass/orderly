import { createWorker } from '../connection.js';
import { createPaymentWorkerProcessor } from './payment-worker.js';
import { createInventoryWorkerProcessor } from './inventory-worker.js';
import { createNotificationWorkerProcessor } from './notification-worker.js';
import { createSagaWorkerProcessor } from './saga-worker.js';
import type { PaymentService } from '../../../domain/services/payment-service.js';
import type { InventoryService } from '../../../domain/services/inventory-service.js';
import type { SagaOrchestrator } from '../../../domain/services/saga-orchestrator.js';
import type { WebhookDispatcher } from '../../../events/webhooks/webhook-dispatcher.js';
import type { Worker } from 'bullmq';
import { logger } from '../../observability/logger.js';

let workers: Worker[] = [];

export interface WorkerDependencies {
  paymentService: PaymentService;
  inventoryService: InventoryService;
  sagaOrchestrator: SagaOrchestrator;
  webhookDispatcher: WebhookDispatcher;
}

/**
 * Start all BullMQ workers with injected singleton dependencies.
 * Workers receive long-lived service instances so circuit breaker state,
 * connection pools, and other singleton state are preserved across jobs.
 */
export function startWorkers(deps: WorkerDependencies): void {
  logger.info('Starting BullMQ workers');

  const paymentWorker = createWorker(
    'payment-processing',
    createPaymentWorkerProcessor(deps.paymentService),
  );
  const inventoryWorker = createWorker(
    'inventory-release',
    createInventoryWorkerProcessor(deps.inventoryService),
  );
  const notificationWorker = createWorker(
    'webhook-delivery',
    createNotificationWorkerProcessor(deps.webhookDispatcher),
  );
  const sagaWorker = createWorker(
    'saga-execution',
    createSagaWorkerProcessor(deps.sagaOrchestrator),
  );

  workers = [paymentWorker, inventoryWorker, notificationWorker, sagaWorker];

  for (const [name, worker] of [
    ['payment', paymentWorker],
    ['inventory', inventoryWorker],
    ['notification', notificationWorker],
    ['saga', sagaWorker],
  ] as const) {
    worker.on('failed', (job, err) => {
      logger.error(
        { err, jobId: job?.id, worker: name },
        'Worker job permanently failed',
      );
    });
    worker.on('error', (err) => {
      logger.error({ err, worker: name }, 'Worker error');
    });
  }
}

export async function stopWorkers(): Promise<void> {
  logger.info('Draining and stopping BullMQ workers');
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}
