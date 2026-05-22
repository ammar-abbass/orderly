import type { PaymentGateway } from '../ports/payment-gateway.js';
import type { ResiliencePolicy } from '../ports/resilience-policy.js';
import type { ILogger } from '../ports/logger.js';
import type { IMetrics } from '../ports/metrics.js';
import type { Money } from '../value-objects/money.js';

export interface PaymentChargeRequest {
  readonly orderId: string;
  readonly amount: Money;
  readonly paymentToken: string;
}

export interface PaymentChargeResult {
  readonly success: boolean;
  readonly transactionId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/**
 * PaymentService — wraps the PaymentGateway with circuit breaker + metrics.
 *
 * IMPORTANT: The ResiliencePolicy (circuit breaker) MUST be injected as a
 * singleton from the composition root. A fresh policy per-request resets the
 * failure counter and breaks the circuit breaker semantics entirely.
 *
 * All dependencies are injected via constructor — no infrastructure imports.
 */
export class PaymentService {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly resilience: ResiliencePolicy,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
  ) {}

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    const startTime = Date.now();
    this.logger.info(
      { orderId: request.orderId, amount: request.amount.amount },
      'Processing payment charge',
    );

    try {
      const result = await this.resilience.execute(() =>
        this.gateway.charge(request.orderId, request.amount, request.paymentToken),
      );

      this.metrics.increment('payment.charged', { status: result.success ? 'success' : 'failed' });
      this.metrics.recordHistogram('payment.charge.duration', Date.now() - startTime);

      if (!result.success) {
        this.logger.warn(
          { orderId: request.orderId, errorCode: result.errorCode },
          'Payment charge declined',
        );
      }

      return result;
    } catch (err) {
      this.logger.error({ err, orderId: request.orderId }, 'Payment charge failed after retries');
      this.metrics.increment('payment.charged', { status: 'circuit_open' });
      return {
        success: false,
        transactionId: null,
        errorCode: 'circuit_open',
        errorMessage: err instanceof Error ? err.message : 'Circuit breaker open',
      };
    }
  }

  async refund(transactionId: string, amount: Money): Promise<PaymentChargeResult> {
    this.logger.info({ transactionId, amount: amount.amount }, 'Processing refund');
    try {
      const result = await this.gateway.refund(transactionId, amount);
      this.metrics.increment('payment.refunded', { status: result.success ? 'success' : 'failed' });
      return result;
    } catch (err) {
      this.logger.error({ err, transactionId }, 'Refund failed');
      return {
        success: false,
        transactionId: null,
        errorCode: 'refund_error',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
