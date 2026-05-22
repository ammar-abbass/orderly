import type { Money } from '../value-objects/money.js';

/**
 * Payment result returned by the PaymentGateway.
 */
export interface PaymentResult {
  readonly success: boolean;
  readonly transactionId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/**
 * PaymentGateway port — domain-level interface for payment processing.
 *
 * The infrastructure layer provides concrete implementations
 * (e.g. StripeAdapter). The composition root wires them together.
 */
export interface PaymentGateway {
  charge(orderId: string, amount: Money, token: string): Promise<PaymentResult>;
  refund(transactionId: string, amount: Money): Promise<PaymentResult>;
}
