import {
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  retry,
  wrap,
} from 'cockatiel';
import { getConfig } from '../../config.js';
import { logger } from '../observability/logger.js';
import { metrics } from '../observability/metrics.js';

// Re-export from domain ports — the canonical interface lives there
export type { ResiliencePolicy } from '../../domain/ports/resilience-policy.js';
import type { ResiliencePolicy } from '../../domain/ports/resilience-policy.js';

/**
 * Compose a RetryPolicy inside a CircuitBreakerPolicy using cockatiel.
 *
 * - Retry:   3 attempts with exponential backoff (100ms base)
 * - Circuit: opens after N consecutive failures, half-open probe after D ms
 *
 * The circuit breaker MUST be a long-lived singleton so failure counts
 * accumulate across job invocations. Create it once in the composition root
 * and inject it into PaymentService.
 *
 * ⚠️ IMPORTANT: This function should be called ONCE at application startup
 * and the result injected wherever needed. Creating new instances breaks
 * the circuit breaker's state tracking.
 */
export function createPaymentResiliencePolicy(): ResiliencePolicy {
  const config = getConfig();

  // Retry: 3 attempts with exponential backoff
  const retryPolicy = retry(handleAll, {
    maxAttempts: 3,
    backoff: new ExponentialBackoff({ initialDelay: 100, maxDelay: 2_000 }),
  });

  // Circuit breaker: opens after N consecutive failures
  const circuitBreakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: config.paymentCircuitBreakerDurationMs,
    breaker: new ConsecutiveBreaker(config.paymentCircuitBreakerThreshold),
  });

  // Event listeners for observability
  circuitBreakerPolicy.onBreak(() => {
    logger.error(
      { threshold: config.paymentCircuitBreakerThreshold },
      'Payment circuit breaker OPENED',
    );
    metrics.increment('payment.circuit_breaker', { state: 'open' });
  });

  circuitBreakerPolicy.onReset(() => {
    logger.info('Payment circuit breaker CLOSED (reset)');
    metrics.increment('payment.circuit_breaker', { state: 'closed' });
  });

  circuitBreakerPolicy.onHalfOpen(() => {
    logger.info('Payment circuit breaker HALF-OPEN (probing)');
    metrics.increment('payment.circuit_breaker', { state: 'half_open' });
  });

  // Wrap: circuitBreaker (outer) → retry (inner)
  // This means: retry happens first, and circuit breaker sees the final result
  // Retry runs inside the circuit breaker: 3 retries count as 1 "call attempt" for the circuit
  const policy = wrap(circuitBreakerPolicy, retryPolicy);

  return {
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      return policy.execute(() => fn());
    },
  };
}
