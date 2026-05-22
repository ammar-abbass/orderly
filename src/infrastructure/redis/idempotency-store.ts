import { getRedis } from './connection.js';
import { getConfig } from '../../config.js';

export interface IdempotencyRecord {
  readonly requestId: string;
  readonly status: number;
  readonly response: string;
  readonly requestHash: string;
  readonly createdAt: string;
}

/**
 * Redis-backed idempotency store.
 * Key format: idempotency:{clientId}:{idempotencyKey}
 * TTL: configurable (default 24h)
 *
 * Degrades gracefully on Redis unavailability — callers catch errors.
 */
export class IdempotencyStore {
  private key(clientId: string, idempotencyKey: string): string {
    return `idempotency:${clientId}:${idempotencyKey}`;
  }

  async get(clientId: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(this.key(clientId, idempotencyKey));
      if (!raw) return null;
      return JSON.parse(raw) as IdempotencyRecord;
    } catch {
      return null; // Graceful degradation
    }
  }

  async set(
    clientId: string,
    idempotencyKey: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    try {
      const redis = getRedis();
      const config = getConfig();
      await redis.set(
        this.key(clientId, idempotencyKey),
        JSON.stringify(record),
        'EX',
        config.idempotencyTtlSeconds,
      );
    } catch {
      // Best-effort — if Redis is down we lose dedup for this key
    }
  }

  async delete(clientId: string, idempotencyKey: string): Promise<void> {
    try {
      const redis = getRedis();
      await redis.del(this.key(clientId, idempotencyKey));
    } catch {
      // Ignore
    }
  }
}
