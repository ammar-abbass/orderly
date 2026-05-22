import { createHash } from 'crypto';
import { getSql } from '../database/connection.js';
import type { LockManager, LockRelease } from './lock-manager.js';
import { logger } from '../observability/logger.js';

/**
 * PostgreSQL session-level advisory lock implementation.
 *
 * Uses pg_try_advisory_lock (non-blocking) with a SHA-256-derived 64-bit
 * integer lock key. Items must be sorted by the caller before acquiring
 * multiple locks to prevent deadlocks.
 *
 * Extraction note: When the inventory domain extracts to a standalone service,
 * replace this with a RedisRedlock implementation of the same LockManager interface.
 */
export class PostgresAdvisoryLock implements LockManager {
  async acquire(
    resourceId: string,
    ttlMs = 30_000,
  ): Promise<LockRelease | null> {
    const sql = getSql();
    const lockId = this.toInt64(resourceId);

    const [result] = await sql<{ pg_try_advisory_lock: boolean }[]>`
      SELECT pg_try_advisory_lock(${lockId.toString()}::bigint)
    `;

    if (!result?.pg_try_advisory_lock) {
      logger.debug({ resourceId, lockId }, 'Advisory lock not available');
      return null;
    }

    let released = false;

    // Auto-release guard — last resort if caller forgets to call release()
    const timer = setTimeout(() => {
      if (!released) {
        logger.warn(
          { resourceId, lockId, ttlMs },
          'Advisory lock TTL expired — force releasing',
        );
        void this.release(lockId);
      }
    }, ttlMs);

    return async (): Promise<void> => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      await this.release(lockId);
    };
  }

  private async release(lockId: bigint): Promise<void> {
    try {
      const sql = getSql();
      await sql`SELECT pg_advisory_unlock(${lockId.toString()}::bigint)`;
    } catch (err) {
      logger.error(
        { err, lockId: lockId.toString() },
        'Failed to release advisory lock',
      );
    }
  }

  /**
   * Derive a stable 64-bit BigInt from an arbitrary resource string using SHA-256.
   * Takes the first 8 bytes of the digest — collision probability is negligible
   * for the SKU cardinality in a typical e-commerce catalog (<10M SKUs).
   */
  private toInt64(resourceId: string): bigint {
    const hash = createHash('sha256').update(resourceId).digest();
    // Read first 8 bytes as big-endian unsigned 64-bit, then sign-extend to signed
    const high = hash.readUInt32BE(0);
    const low = hash.readUInt32BE(4);
    const unsigned = (BigInt(high) << 32n) | BigInt(low);
    // pg_advisory_lock takes signed bigint — mask to signed range
    const signed = BigInt.asIntN(64, unsigned);
    return signed;
  }
}
