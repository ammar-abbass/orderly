import type { Job } from 'bullmq';
import type { PaymentService } from '../../../domain/services/payment-service.js';
import { Money } from '../../../domain/value-objects/money.js';
import { logger } from '../../observability/logger.js';
import { metrics } from '../../observability/metrics.js';

export interface PaymentJobData {
  readonly orderId: string;
  readonly amount: { amount: string; currency: string };
  readonly paymentToken: string;
  readonly sagaId: string;
}

/**
 * Returns a payment worker processor that uses the provided singleton PaymentService.
 *
 * The PaymentService (and its circuit breaker) must be long-lived singletons —
 * created once in the composition root and passed here. This ensures the circuit
 * breaker failure count accumulates across job invocations.
 */
export function createPaymentWorkerProcessor(paymentService: PaymentService) {
  return async (job: Job<PaymentJobData>): Promise<void> => {
    const { orderId, amount, paymentToken, sagaId } = job.data;
    logger.info({ jobId: job.id, orderId, sagaId }, 'Processing payment job');

    const result = await paymentService.charge({
      orderId,
      amount: new Money(amount.amount, amount.currency),
      paymentToken,
    });

    if (!result.success) {
      metrics.increment('payment.worker.failed');
      logger.error(
        { jobId: job.id, orderId, error: result.errorMessage },
        'Payment job failed — BullMQ will retry',
      );
      throw new Error(`Payment failed: ${result.errorMessage}`);
    }

    metrics.increment('payment.worker.succeeded');
    logger.info(
      { jobId: job.id, orderId, transactionId: result.transactionId },
      'Payment job succeeded',
    );
  };
}
