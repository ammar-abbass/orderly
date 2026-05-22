# Runbooks

## R1: Queue Backlog > 10,000 Jobs

**Symptom:** `queue.depth` metric > 10,000; API returning 503.

1. Check Grafana `queue.depth` by queue name.
2. If payment worker lag:
   - Scale payment worker pods: `kubectl scale deployment orderly --replicas=5`
   - Or check circuit breaker: `GET /admin/v1/health/deep`
3. If DB slow: `SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;`
4. If gateway down: circuit breaker is open — jobs queued, no data loss. Wait for reset.

---

## R2: Saga Stuck in RUNNING > 10 Minutes

**Symptom:** Alert on `saga.running.age > 10m` or found via admin API.

```bash
# Find stuck sagas
curl -H "X-API-Key: $ADMIN_KEY" \
  "http://localhost:3001/admin/v1/sagas?olderThanMinutes=10"

# Trigger manual compensation
curl -X POST -H "X-API-Key: $ADMIN_KEY" \
  "http://localhost:3001/admin/v1/sagas/{sagaId}/compensate"
```

If worker crashed mid-saga, the next worker startup re-queries the saga state and continues from the persisted step. Manual compensation is only needed for genuinely stuck sagas.

---

## R3: DLQ Jobs Accumulating

**Symptom:** `queue.dlq.size` growing over time.

```bash
# List DLQ jobs
curl -H "X-API-Key: $ADMIN_KEY" "http://localhost:3001/admin/v1/dlq"

# Retry a specific job
curl -X POST -H "X-API-Key: $ADMIN_KEY" \
  "http://localhost:3001/admin/v1/dlq/retry/{jobId}?queue=payment-processing"
```

Root causes to investigate:
- Payment gateway permanently down → check circuit breaker state
- Invalid job data → examine `data` field in DLQ response
- Downstream webhook consistently failing → check subscriber health

---

## R4: Redis Connection Failure

**Symptom:** Logs show Redis errors; rate limiting disabled; idempotency degraded.

Service continues with degraded mode:
- Idempotency falls back to DB (slower but safe)
- Rate limiting disabled (monitor-only mode)
- **BullMQ workers will stall** — they require Redis

Actions:
1. Restore Redis immediately (queue processing paused)
2. Check for duplicate orders that slipped through during degradation
3. On Redis restore, workers auto-reconnect and drain backlog

---

## R5: Payment Circuit Breaker Open

**Symptom:** `payment.circuit_breaker{state="open"}` metric; orders queuing but not processing.

```bash
curl "http://localhost:3000/health/deep"
```

- Circuit auto-resets after 10 seconds (configurable via `PAYMENT_CIRCUIT_BREAKER_DURATION_MS`)
- Jobs remain queued — no order data loss
- If gateway down > 30 min: consider pausing `payment-processing` queue to prevent job TTL expiry

---

## R6: PostgreSQL Connection Pool Exhausted

**Symptom:** 503 errors; `pg_stat_activity` shows many idle connections.

```sql
SELECT count(*), state FROM pg_stat_activity WHERE datname = 'orders' GROUP BY state;
```

- Check `DATABASE_POOL_SIZE` env var (default 20 per instance)
- Rolling restart reduces pool leak if present
- Long-term: add PgBouncer as a sidecar

---

## R7: Outbox Events Stuck in PENDING

**Symptom:** `outbox_events` table has many PENDING rows; `outbox.published` metric not increasing.

```sql
SELECT count(*), status FROM outbox_events GROUP BY status;
```

1. Check OutboxProcessor logs — it may have crashed
2. Process restarts will automatically resume polling
3. If `retry_count >= outbox_max_retries`: events marked FAILED — investigate root cause, then reset:

```sql
-- Reset specific failed outbox events for retry
UPDATE outbox_events SET status = 'PENDING', retry_count = 0
WHERE id = '{event_id}';
```
