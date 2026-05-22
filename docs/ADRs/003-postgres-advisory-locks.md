# ADR-003: PostgreSQL Advisory Locks over Redis Redlock

**Status:** Accepted  
**Date:** 2026-05-15

## Context

Inventory reservation must be mutually exclusive per SKU. Two concurrent orders for the last unit of stock must not both succeed. We need a locking mechanism that:

1. Prevents overselling under concurrent load
2. Works correctly if a process crashes mid-operation (auto-release)
3. Can be replaced when the inventory service is extracted

## Decision

Use **PostgreSQL session-level advisory locks** (`pg_try_advisory_lock` / `pg_advisory_unlock`) for the initial single-service architecture.

## Alternatives Considered

### Database row-level locks (SELECT FOR UPDATE)

This is what the `InventoryRepository.reserve()` does as a second layer of protection. However, relying solely on `SELECT FOR UPDATE` without application-level locking can lead to long transaction hold times and deadlocks when acquiring locks on multiple SKUs in an order.

Advisory locks let us:
- Lock at the application level before entering the transaction
- Sort locks alphabetically to prevent deadlocks
- Use non-blocking `pg_try_advisory_lock` (returns false rather than waiting forever)

### Redis Redlock

**Not selected now; documented for future extraction.**

Redlock is appropriate when:
- The locking service runs on multiple nodes (Redlock requires ≥ 3 Redis nodes for safety)
- The lock must span multiple database instances

In a single-service architecture, advisory locks are strictly safer because:
- No clock skew between the lock holder and Redis
- No network partition between the app and its lock store (same DB connection)
- Session-scoped: if the process crashes, PostgreSQL automatically releases the lock when the connection closes

### Optimistic locking (version column)

Already present in the `inventory.version` column as a last-resort defence. Not used as the primary concurrency control because it requires retries on conflict, which would increase latency unpredictably under high contention.

## Consequences

**Positive:**
- Zero additional infrastructure
- Session-scoped auto-release on process crash — no orphaned locks
- `pg_try_advisory_lock` never blocks (returns false immediately if lock held)
- Items sorted alphabetically before locking — deadlock-free by design

**Negative:**
- Advisory lock key is a `bigint` — must hash SKU strings to a 64-bit integer. Hash collisions are possible (probability ~1 in 4 billion). Documented in SPEC §19 as a known risk.
- Does not work across multiple PostgreSQL instances. Must migrate to Redlock when the inventory service splits to its own database.

## Extraction Note

The `LockManager` interface in `src/infrastructure/locking/lock-manager.ts` is the abstraction boundary. To migrate to Redlock, implement `LockManager` using the `redlock` npm package and swap the implementation in `src/index.ts`. Zero changes to domain code.
