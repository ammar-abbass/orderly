import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderService } from '../../../src/domain/services/order-service.js';
import type { IOrderRepository } from '../../../src/domain/repositories/interfaces.js';
import type { OutboxRepository } from '../../../src/domain/repositories/outbox-repository.js';
import type { ISagaEnqueuer } from '../../../src/domain/services/order-service.js';
import type { ITransactionManager } from '../../../src/domain/ports/transaction-manager.js';
import type { ILogger } from '../../../src/domain/ports/logger.js';
import type { IMetrics } from '../../../src/domain/ports/metrics.js';

function makeMockOrderRepo(): IOrderRepository {
  return {
    findById: vi.fn(),
    createWithSql: vi.fn(),
    updateStatus: vi.fn(),
    findByIdempotencyKey: vi.fn(),
  };
}

function makeMockOutboxRepo(): OutboxRepository {
  return {
    createWithSql: vi.fn(),
    getPending: vi.fn(),
    markPublished: vi.fn(),
    markFailed: vi.fn(),
    resetForRetry: vi.fn(),
  } as unknown as OutboxRepository;
}

function makeMockSagaEnqueuer(): ISagaEnqueuer {
  return { enqueue: vi.fn().mockResolvedValue('job-1') };
}

function makeMockTxManager(): ITransactionManager {
  return {
    begin: vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn()),
  };
}

function makeMockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeMockMetrics(): IMetrics {
  return { increment: vi.fn(), recordHistogram: vi.fn() };
}

describe('OrderService', () => {
  let orderRepo: IOrderRepository;
  let outboxRepo: OutboxRepository;
  let sagaEnqueuer: ISagaEnqueuer;
  let txManager: ITransactionManager;
  let service: OrderService;

  beforeEach(() => {
    orderRepo = makeMockOrderRepo();
    outboxRepo = makeMockOutboxRepo();
    sagaEnqueuer = makeMockSagaEnqueuer();
    txManager = makeMockTxManager();
    service = new OrderService(
      orderRepo,
      outboxRepo,
      sagaEnqueuer,
      txManager,
      makeMockLogger(),
      makeMockMetrics(),
    );
  });

  describe('createOrder', () => {
    it('creates an order, saves it, inserts an outbox event, and enqueues the saga', async () => {
      const result = await service.createOrder({
        customerId: 'cust-1',
        items: [{ sku: 'SKU-1', quantity: 2, unitPrice: '10.00' }],
        currency: 'USD',
        paymentToken: 'tok_1',
        idempotencyKey: 'idemp-1',
      });

      expect(result.order).toBeDefined();
      expect(result.order.status).toBe('PENDING');
      expect(orderRepo.createWithSql).toHaveBeenCalled();
      expect(outboxRepo.createWithSql).toHaveBeenCalled();
      expect(sagaEnqueuer.enqueue).toHaveBeenCalled();
    });
  });

  describe('getOrder', () => {
    it('returns an order if found', async () => {
      const mockOrder = { id: 'order-1', status: 'PENDING' };
      vi.mocked(orderRepo.findById).mockResolvedValue(mockOrder as any);

      const order = await service.getOrder('order-1');
      expect(order).toEqual(mockOrder);
      expect(orderRepo.findById).toHaveBeenCalledWith('order-1');
    });
  });
});
