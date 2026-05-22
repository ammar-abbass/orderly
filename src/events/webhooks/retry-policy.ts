import { getConfig } from '../../config.js';

/**
 * Calculate the delay in milliseconds for a webhook retry attempt.
 *
 * Uses exponential backoff with ±30% random jitter to prevent thundering-herd
 * when many webhooks fail simultaneously and retry at the same instant.
 *
 * Example delays with 1000ms base:
 *   attempt 0 → ~1,000ms (1–1,300ms with jitter)
 *   attempt 1 → ~2,000ms (2,000–2,600ms)
 *   attempt 2 → ~4,000ms
 *   attempt 5 → ~32,000ms
 *   max       → 86,400,000ms (24 hours)
 */
export function calculateRetryDelay(attempt: number): number {
  const config = getConfig();
  const base = config.webhookRetryBaseDelayMs;
  const exponential = base * Math.pow(2, attempt);
  const jitter = Math.random() * exponential * 0.3;
  return Math.min(Math.round(exponential + jitter), 86_400_000);
}
