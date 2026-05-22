import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Recursively sort all object keys for deterministic JSON canonicalization.
 * Handles nested objects and arrays (array order is preserved).
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Sign a webhook payload using HMAC-SHA256.
 * Keys are sorted recursively at all nesting levels for a canonical JSON representation.
 */
export function signPayload(payload: Record<string, unknown>, secret: string): string {
  const canonical = JSON.stringify(canonicalize(payload));
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Verify a webhook signature using a constant-time comparison.
 * Returns false on any error (wrong length, bad hex, etc.).
 */
export function verifyPayload(
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
): boolean {
  try {
    const expected = Buffer.from(signPayload(payload, secret), 'hex');
    const provided = Buffer.from(signature, 'hex');
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}
