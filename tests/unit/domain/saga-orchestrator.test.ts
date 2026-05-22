import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SagaOrchestrator } from '../../../src/domain/services/saga-orchestrator.js';
import type { IOrderRepository, ISagaRepository } from '../../../src/domain/repositories/interfaces.js';
import type { OutboxRepository } from '../../../src/domain/repositories/outbox-repository.js';
import type { InventoryService } from '../../../src/domain/services/inventory-service.js';
import type { PaymentService } from '../../../src/domain/services/payment-service.js';
import type { ITransactionManager } from '../../../src/domain/ports/transaction-manager.js';
import type { ILogger } from '../../../src/domain/ports/logger.js';
import type { IMetrics } from '../../../src/domain/ports/metrics.js';

function makeMockOrderRepo(): IOrderRepository {
  return {
    findById: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    createWithSql: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function makeMockSagaRepo(): ISagaRepository {
  return {
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    findByOrderId: vi.fn(),
    createStep: vi.fn(),
    updateStep: vi.fn(),
    getSteps: vi.fn().mockResolvedValue([]),
    findRunningSagas: vi.fn(),
  };
}

function makeMockOutboxRepo(): OutboxRepository {
  return { createWithSql: vi.fn() } as unknown as OutboxRepository;
}

function makeMockInventoryService(): InventoryService {
  return {
    reserveInventory: vi.fn().mockResolvedValue(true),
    releaseInventory: vi.fn().mockResolvedValue(true),
  } as unknown as InventoryService;
}

function makeMockPaymentService(): PaymentService {
  return {
    charge: vi.fn().mockResolvedValue({ success: true, transactionId: 'charge-1', errorCode: null, errorMessage: null }),
    refund: vi.fn().mockResolvedValue({ success: true, transactionId: 'refund-1', errorCode: null, errorMessage: null }),
  } as unknown as PaymentService;
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

describe('SagaOrchestrator', () => {
  let orderRepo: IOrderRepository;
  let sagaRepo: ISagaRepository;
  let outboxRepo: OutboxRepository;
  let inventoryService: InventoryService;
  let paymentService: PaymentService;
  let txManager: ITransactionManager;
  let orchestrator: SagaOrchestrator;

  beforeEach(() => {
    orderRepo = makeMockOrderRepo();
    sagaRepo = makeMockSagaRepo();
    outboxRepo = makeMockOutboxRepo();
    inventoryService = makeMockInventoryService();
    paymentService = makeMockPaymentService();
    txManager = makeMockTxManager();

    orchestrator = new SagaOrchestrator(
      orderRepo,
      sagaRepo,
      outboxRepo,
      inventoryService,
      paymentService,
      txManager,
      makeMockLogger(),
      makeMockMetrics()
    );
  });

  describe('startSaga', () => {
    it('executes saga successfully to completion', async () => {
      await orchestrator.startSaga({
        orderId: 'order-1',
        customerId: 'cust-1',
        items: [{ sku: 'SKU-1', quantity: 1 }],
        totalAmount: { amount: '10.00', currency: 'USD' },
        paymentToken: 'tok_1',
      });

      expect(inventoryService.reserveInventory).toHaveBeenCalled();
      expect(paymentService.charge).toHaveBeenCalled();
      expect(orderRepo.updateStatus).toHaveBeenCalledWith('order-1', 'PAID', undefined);
      expect(sagaRepo.update).toHaveBeenCalled();
    });

    it('compensates when inventory reservation fails', async () => {
      vi.mocked(inventoryService.reserveInventory).mockResolvedValue(false);
      
      const result = await orchestrator.startSaga({
        orderId: 'order-1',
        customerId: 'cust-1',
        items: [{ sku: 'SKU-1', quantity: 1 }],
        totalAmount: { amount: '10.00', currency: 'USD' },
        paymentToken: 'tok_1',
      });

      expect(result.status).toBe('FAILED');
      expect(orderRepo.updateStatus).toHaveBeenCalledWith('order-1', 'CANCELLED', undefined);
    });
  });
});
