import type { IInventoryRepository } from '../repositories/interfaces.js';
import type { LockManager } from '../ports/lock-manager.js';
import type { ILogger } from '../ports/logger.js';
import type { IMetrics } from '../ports/metrics.js';

export interface InventoryReservation {
  readonly sku: string;
  readonly quantity: number;
}

/**
 * InventoryService — manages inventory reservation and release.
 *
 * Uses the LockManager interface (currently PostgresAdvisoryLock) to ensure
 * mutual exclusion during reservation. Items are sorted alphabetically before
 * locking to prevent deadlocks when multiple orders compete for the same SKUs.
 *
 * All dependencies injected via constructor — no infrastructure imports.
 */
export class InventoryService {
  constructor(
    private readonly inventoryRepo: IInventoryRepository,
    private readonly lockManager: LockManager,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
  ) {}

  /**
   * Reserve inventory for all items in an order.
   * Acquires per-SKU advisory locks, checks availability, then atomically reserves.
   * Returns true if all items reserved. Returns false on insufficient stock or lock failure.
   *
   * Compensation: call releaseInventory with the same items to undo.
   */
  async reserveInventory(
    orderId: string,
    items: readonly InventoryReservation[],
  ): Promise<boolean> {
    const startTime = Date.now();
    this.logger.info({ orderId, itemCount: items.length }, 'Reserving inventory');

    // Sort alphabetically to prevent deadlocks across concurrent orders
    const sorted = [...items].sort((a, b) => a.sku.localeCompare(b.sku));
    const releases: Array<() => Promise<void>> = [];

    try {
      for (const item of sorted) {
        const release = await this.lockManager.acquire(`inventory:${item.sku}`, 10_000);
        if (!release) {
          this.logger.warn({ orderId, sku: item.sku }, 'Could not acquire inventory lock — contention');
          return false;
        }
        releases.push(release);

        const inventory = await this.inventoryRepo.findBySku(item.sku);
        if (!inventory || inventory.available < item.quantity) {
          this.logger.warn(
            { orderId, sku: item.sku, available: inventory?.available, requested: item.quantity },
            'Insufficient inventory',
          );
          return false;
        }

        const success = await this.inventoryRepo.reserve(item.sku, item.quantity);
        if (!success) {
          this.logger.warn({ orderId, sku: item.sku }, 'Inventory reserve UPDATE affected 0 rows');
          return false;
        }
        this.metrics.increment('inventory.reserved', { sku: item.sku });
      }

      this.metrics.recordHistogram('inventory.reservation.duration', Date.now() - startTime);
      this.logger.info({ orderId }, 'Inventory reserved successfully');
      return true;
    } finally {
      // Always release all held locks, even on failure
      await Promise.allSettled(releases.map((r) => r()));
    }
  }

  /**
   * Release reserved inventory for all items (saga compensation).
   */
  async releaseInventory(
    orderId: string,
    items: readonly InventoryReservation[],
  ): Promise<boolean> {
    this.logger.info({ orderId, itemCount: items.length }, 'Releasing inventory');
    const sorted = [...items].sort((a, b) => a.sku.localeCompare(b.sku));
    const releases: Array<() => Promise<void>> = [];

    try {
      for (const item of sorted) {
        const release = await this.lockManager.acquire(`inventory:${item.sku}`, 10_000);
        if (!release) {
          this.logger.error({ orderId, sku: item.sku }, 'Could not acquire lock for inventory release');
          return false;
        }
        releases.push(release);

        const success = await this.inventoryRepo.release(item.sku, item.quantity);
        if (!success) {
          this.logger.error({ orderId, sku: item.sku }, 'Inventory release failed');
          return false;
        }
        this.metrics.increment('inventory.released', { sku: item.sku });
      }

      this.logger.info({ orderId }, 'Inventory released successfully');
      return true;
    } finally {
      await Promise.allSettled(releases.map((r) => r()));
    }
  }
}
