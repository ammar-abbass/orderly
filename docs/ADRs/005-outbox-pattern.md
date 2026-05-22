# ADR-005: Transactional Outbox Pattern over Direct Publishing

**Status:** Accepted  
**Date:** 2026-05-15

## Context

When an order is created, events must be published to trigger downstream processing (payment, inventory, webhooks). If the application publishes events directly to BullMQ after committing the database transaction, a crash between the commit and the publish loses the event permanently. Conversely, publishing before committing risks publishing events for transactions that are rolled back.

We need **at-least-once** event delivery with **zero event loss**.

## Decision

Use the **Transactional Outbox** pattern: write events to an `outbox_events` table in the **same database transaction** as the business logic, then poll and publish to BullMQ asynchronously.

## Alternatives Considered

### Direct publishing (emit after commit)

**Rejected.** If the process crashes between `COMMIT` and `queue.add()`, the event is lost. This is the "dual write" problem and cannot be solved without additional infrastructure.

### Change Data Capture (Debezium)

**Not selected.** Debezium tailing the PostgreSQL WAL is an excellent solution for Kafka-based architectures but adds significant infrastructure (Debezium + Kafka Connect). Overkill for a single-service system using BullMQ.

### Transaction log tailing

**Not selected.** Database-specific, harder to maintain, and requires deep PostgreSQL internals knowledge.

## Consequences

**Positive:**

- Events are never lost — they are committed atomically with the business data
- At-least-once delivery is guaranteed by the outbox poller
- BullMQ job IDs are derived from outbox event IDs, preventing duplicate processing (idempotent consumers)
- Events are published in creation order within a single transaction
- The outbox table serves as an audit log of all domain events

**Negative:**

- Adds ~2ms write latency per event (one additional INSERT per transaction)
- Requires a background poller process (`OutboxProcessor`) to poll and publish
- Delivery latency depends on poll interval (currently 500ms) — events are not instant
- The outbox table must be periodically cleaned up to prevent unbounded growth (handled by `OutboxProcessor.cleanup()`)
