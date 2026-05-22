import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService } from '../../../src/domain/services/payment-service.js';
import type { PaymentGateway } from '../../../src/domain/ports/payment-gateway.js';
import type { ResiliencePolicy } from '../../../src/domain/ports/resilience-policy.js';
import type { ILogger } from '../../../src/domain/ports/logger.js';
import type { IMetrics } from '../../../src/domain/ports/metrics.js';

import { Money } from '../../../src/domain/value-objects/money.js';

function makeMockGateway(): PaymentGateway {
  return {
    charge: vi.fn().mockResolvedValue({ success: true, transactionId: 'charge-1', errorCode: null, errorMessage: null }),
    refund: vi.fn().mockResolvedValue({ success: true, transactionId: 'refund-1', errorCode: null, errorMessage: null }),
  };
}

function makeMockResilience(): ResiliencePolicy {
  return {
    execute: vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn()),
  };
}

function makeMockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeMockMetrics(): IMetrics {
  return { increment: vi.fn(), recordHistogram: vi.fn() };
}

describe('PaymentService', () => {
  let gateway: PaymentGateway;
  let resilience: ResiliencePolicy;
  let service: PaymentService;

  beforeEach(() => {
    gateway = makeMockGateway();
    resilience = makeMockResilience();
    service = new PaymentService(
      gateway,
      resilience,
      makeMockLogger(),
      makeMockMetrics()
    );
  });

  describe('charge', () => {
    it('processes payment successfully', async () => {
      const amount = new Money('50.00', 'USD');
      const result = await service.charge({ orderId: 'order-1', paymentToken: 'tok_123', amount });
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('charge-1');
      expect(gateway.charge).toHaveBeenCalledWith('order-1', amount, 'tok_123');
      expect(resilience.execute).toHaveBeenCalled();
    });

    it('returns circuit open on failure', async () => {
      vi.mocked(gateway.charge).mockRejectedValue(new Error('Card declined'));
      const amount = new Money('50.00', 'USD');
      const result = await service.charge({ orderId: 'order-1', paymentToken: 'tok_123', amount });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('circuit_open');
    });
  });

  describe('refund', () => {
    it('refunds successfully', async () => {
      const amount = new Money('50.00', 'USD');
      const result = await service.refund('charge-1', amount);
      expect(result.success).toBe(true);
      expect(gateway.refund).toHaveBeenCalledWith('charge-1', amount);
    });
  });
});
