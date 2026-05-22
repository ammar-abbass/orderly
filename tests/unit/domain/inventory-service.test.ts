import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryService } from '../../../src/domain/services/inventory-service.js';
import type { IInventoryRepository, InventoryRecord } from '../../../src/domain/repositories/interfaces.js';
import type { LockManager } from '../../../src/domain/ports/lock-manager.js';
import type { ILogger } from '../../../src/domain/ports/logger.js';
import type { IMetrics } from '../../../src/domain/ports/metrics.js';

function makeInventory(sku: string, available: number): InventoryRecord {
  return { sku, available, reserved: 0, version: 1 };
}

function makeMockRepo(): IInventoryRepository {
  return {
    findBySku: vi.fn(),
    reserve: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(true),
    seedInventory: vi.fn(),
  };
}

function makeMockLock(): LockManager {
  const releaseFn = vi.fn().mockResolvedValue(undefined);
  return {
    acquire: vi.fn().mockResolvedValue(releaseFn),
  };
}

function makeMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeMockMetrics(): IMetrics {
  return {
    increment: vi.fn(),
    recordHistogram: vi.fn(),
  };
}

describe('InventoryService', () => {
  let repo: IInventoryRepository;
  let lock: LockManager;
  let service: InventoryService;

  beforeEach(() => {
    repo = makeMockRepo();
    lock = makeMockLock();
    service = new InventoryService(repo, lock, makeMockLogger(), makeMockMetrics());
  });

  describe('reserveInventory', () => {
    it('reserves successfully when stock is available', async () => {
      vi.mocked(repo.findBySku).mockResolvedValue(makeInventory('SKU-A', 10));
      const result = await service.reserveInventory('order-1', [{ sku: 'SKU-A', quantity: 2 }]);
      expect(result).toBe(true);
      expect(repo.reserve).toHaveBeenCalledWith('SKU-A', 2);
    });

    it('returns false when insufficient stock', async () => {
      vi.mocked(repo.findBySku).mockResolvedValue(makeInventory('SKU-A', 1));
      const result = await service.reserveInventory('order-1', [{ sku: 'SKU-A', quantity: 5 }]);
      expect(result).toBe(false);
      expect(repo.reserve).not.toHaveBeenCalled();
    });

    it('returns false when SKU not found', async () => {
      vi.mocked(repo.findBySku).mockResolvedValue(null);
      const result = await service.reserveInventory('order-1', [{ sku: 'GHOST', quantity: 1 }]);
      expect(result).toBe(false);
    });

    it('returns false when lock not acquired', async () => {
      vi.mocked(lock.acquire).mockResolvedValue(null);
      const result = await service.reserveInventory('order-1', [{ sku: 'SKU-A', quantity: 1 }]);
      expect(result).toBe(false);
    });

    it('always releases locks even on failure', async () => {
      const releaseFn = vi.fn().mockResolvedValue(undefined);
      vi.mocked(lock.acquire).mockResolvedValue(releaseFn);
      vi.mocked(repo.findBySku).mockResolvedValue(makeInventory('SKU-A', 1));
      vi.mocked(repo.reserve).mockRejectedValue(new Error('DB error'));

      await expect(
        service.reserveInventory('order-1', [{ sku: 'SKU-A', quantity: 1 }]),
      ).rejects.toThrow('DB error');

      expect(releaseFn).toHaveBeenCalled();
    });

    it('sorts items alphabetically before locking (deadlock prevention)', async () => {
      vi.mocked(repo.findBySku).mockResolvedValue(makeInventory('any', 10));
      const acquireOrder: string[] = [];
      vi.mocked(lock.acquire).mockImplementation(async (id: string) => {
        acquireOrder.push(id);
        return vi.fn().mockResolvedValue(undefined);
      });

      await service.reserveInventory('order-1', [
        { sku: 'SKU-Z', quantity: 1 },
        { sku: 'SKU-A', quantity: 1 },
        { sku: 'SKU-M', quantity: 1 },
      ]);

      expect(acquireOrder).toEqual([
        'inventory:SKU-A',
        'inventory:SKU-M',
        'inventory:SKU-Z',
      ]);
    });
  });

  describe('releaseInventory', () => {
    it('releases reserved stock', async () => {
      const result = await service.releaseInventory('order-1', [{ sku: 'SKU-A', quantity: 2 }]);
      expect(result).toBe(true);
      expect(repo.release).toHaveBeenCalledWith('SKU-A', 2);
    });
  });
});
