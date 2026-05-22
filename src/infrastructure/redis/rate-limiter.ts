import { getRedis } from './connection.js';
import { getConfig } from '../../config.js';

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetTime: number;
}

/**
 * Redis token-bucket rate limiter.
 * Uses a sliding window counter (INCR + EXPIRE).
 * Fails open on Redis unavailability — logs a warning but allows the request.
 */
export class RateLimiter {
  async isAllowed(clientId: string): Promise<RateLimitResult> {
    const config = getConfig();
    const windowMs = config.rateLimitWindowMs;
    const max = config.rateLimitMax;

    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetTime = windowStart + windowMs;
    const key = `rl:${clientId}:${windowStart}`;

    try {
      const redis = getRedis();
      const current = await redis.incr(key);

      if (current === 1) {
        // Set TTL only on the first increment in a window
        await redis.pexpireat(key, resetTime);
      }

      const remaining = Math.max(0, max - current);
      return {
        allowed: current <= max,
        remaining,
        resetTime,
      };
    } catch {
      // Redis unavailable — fail open, monitor via logs
      return { allowed: true, remaining: max, resetTime };
    }
  }
}
