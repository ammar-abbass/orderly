import { Decimal } from 'decimal.js';
import type { PaymentGateway, PaymentResult } from './gateway.js';
import type { Money } from '../../domain/value-objects/money.js';
import { getConfig } from '../../config.js';
import { logger } from '../observability/logger.js';

/**
 * Stripe HTTP adapter implementing the PaymentGateway interface.
 *
 * Uses the raw Stripe REST API to keep the dependency graph clean.
 * In a real deployment swap this for the official `stripe` npm SDK.
 *
 * NOTE: PAYMENT_GATEWAY_API_KEY and PAYMENT_GATEWAY_BASE_URL must be set
 *       in production; the adapter logs a warning if they are empty.
 */
export class StripeAdapter implements PaymentGateway {
  async charge(orderId: string, amount: Money, token: string): Promise<PaymentResult> {
    const config = getConfig();

    if (!config.paymentGatewayApiKey) {
      logger.warn({ orderId }, 'PAYMENT_GATEWAY_API_KEY is not set — simulating success in dev');
      return {
        success: true,
        transactionId: `sim_${crypto.randomUUID()}`,
        errorCode: null,
        errorMessage: null,
      };
    }

    logger.info({ orderId, amount: amount.amount, currency: amount.currency }, 'Charging via Stripe');

    try {
      const response = await fetch(`${config.paymentGatewayBaseUrl}/v1/charges`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.paymentGatewayApiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          // Stripe expects amount in smallest currency unit (cents)
          // Use Decimal.js to avoid floating-point errors (e.g. parseFloat('19.99') * 100 = 1998.9999...)
          amount: new Decimal(amount.amount).times(100).toFixed(0),
          currency: amount.currency.toLowerCase(),
          source: token,
          'metadata[orderId]': orderId,
        }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        return {
          success: false,
          transactionId: null,
          errorCode: error.error?.code ?? 'payment_failed',
          errorMessage: error.error?.message ?? 'Payment processing failed',
        };
      }

      const data = (await response.json()) as { id: string };
      return {
        success: true,
        transactionId: data.id,
        errorCode: null,
        errorMessage: null,
      };
    } catch (err) {
      logger.error({ err, orderId }, 'Stripe network error during charge');
      throw err; // Let circuit breaker / retry policy handle it
    }
  }

  async refund(transactionId: string, amount: Money): Promise<PaymentResult> {
    const config = getConfig();

    if (!config.paymentGatewayApiKey) {
      logger.warn({ transactionId }, 'PAYMENT_GATEWAY_API_KEY not set — simulating refund success');
      return {
        success: true,
        transactionId: `ref_${crypto.randomUUID()}`,
        errorCode: null,
        errorMessage: null,
      };
    }

    try {
      const response = await fetch(`${config.paymentGatewayBaseUrl}/v1/refunds`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.paymentGatewayApiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          charge: transactionId,
          amount: new Decimal(amount.amount).times(100).toFixed(0),
        }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        return {
          success: false,
          transactionId: null,
          errorCode: error.error?.code ?? 'refund_failed',
          errorMessage: error.error?.message ?? 'Refund failed',
        };
      }

      const data = (await response.json()) as { id: string };
      return {
        success: true,
        transactionId: data.id,
        errorCode: null,
        errorMessage: null,
      };
    } catch (err) {
      logger.error({ err, transactionId }, 'Stripe network error during refund');
      throw err;
    }
  }
}
