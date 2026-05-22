/** Release function returned when a lock is acquired. */
export type LockRelease = () => Promise<void>;

/**
 * LockManager port — domain-level interface for distributed mutual exclusion.
 *
 * Current implementation: PostgresAdvisoryLock (single-service, no clock skew).
 * Extraction path: swap for RedisRedlock when inventory service splits out.
 */
export interface LockManager {
  /**
   * Try to acquire a lock for the given resource.
   * @returns A release function, or null if the lock is already held.
   */
  acquire(resourceId: string, ttlMs?: number): Promise<LockRelease | null>;
}
