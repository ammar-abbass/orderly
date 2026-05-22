import type { Job } from 'bullmq';
import type { InventoryService } from '../../../domain/services/inventory-service.js';
import { logger } from '../../observability/logger.js';
import { metrics } from '../../observability/metrics.js';

export interface InventoryJobData {
  readonly orderId: string;
  readonly items: ReadonlyArray<{ sku: string; quantity: number }>;
  readonly action: 'reserve' | 'release';
}

export function createInventoryWorkerProcessor(inventoryService: InventoryService) {
  return async (job: Job<InventoryJobData>): Promise<void> => {
    const { orderId, items, action } = job.data;
    logger.info({ jobId: job.id, orderId, action }, 'Processing inventory job');

    const success =
      action === 'reserve'
        ? await inventoryService.reserveInventory(orderId, items)
        : await inventoryService.releaseInventory(orderId, items);

    if (!success) {
      metrics.increment('inventory.worker.failed', { action });
      throw new Error(`Inventory ${action} failed for order ${orderId}`);
    }

    metrics.increment('inventory.worker.succeeded', { action });
    logger.info({ jobId: job.id, orderId, action }, 'Inventory job succeeded');
  };
}
