# ADR-002: BullMQ over Kafka

**Status:** Accepted  
**Date:** 2026-05-15

## Context

We need an async job queue that supports:

- Per-job retry with exponential backoff
- Dead-letter queue (DLQ) for permanently failed jobs
- Job priority and delayed execution
- Rate limiting per consumer
- Stalled job detection and recovery

## Decision

Use **BullMQ** (Redis-backed) for all async job processing.

## Alternatives Considered

### Apache Kafka

**Not selected for this architecture.** Kafka is excellent for high-throughput event streaming (millions of events/second) and multi-consumer fan-out but adds significant operational burden:

| Capability              | Kafka                            | BullMQ                          |
| ----------------------- | -------------------------------- | ------------------------------- |
| Per-job retry + backoff | Manual                           | Built-in                        |
| Dead-letter queue       | Manual (DLQ topic)               | Built-in                        |
| Priority queues         | Not native                       | Built-in                        |
| Delayed jobs            | Not native                       | Built-in                        |
| Rate limiting           | Manual                           | Built-in                        |
| Stalled job recovery    | Manual                           | Built-in                        |
| Operational setup       | Broker cluster + ZooKeeper/KRaft | Redis only                      |
| Throughput ceiling      | Millions/sec                     | ~10,000 jobs/sec (single Redis) |

For an order service processing hundreds to a few thousand orders per minute, BullMQ's operational simplicity and built-in primitives outweigh Kafka's throughput advantage.

### RabbitMQ

**Not selected.** RabbitMQ adds value when:

- Multiple independent services need to consume the same event (fan-out)
- AMQP protocol interoperability is required
- Exchange-based routing by headers/topic is needed

None of these apply to this service. BullMQ's DLQ, retry, and priority primitives would all need to be manually implemented on top of RabbitMQ.

## Consequences

**Positive:**

- Zero infrastructure beyond Redis (already required for rate limiting and idempotency)
- All job management primitives (retry, DLQ, priority, delay) work out of the box
- BullMQ is production-proven at scale (used by Vercel, Linear, and many others)
- Admin DLQ inspection and retry via simple HTTP calls to the Admin API

**Negative:**

- Redis is a single point of failure for the queue. Redis Sentinel or Cluster is required for production HA.
- Throughput ceiling: ~10,000 jobs/second per Redis instance. Above this, consider Redis Cluster or migration to Kafka.
- Jobs are not replicated — if Redis data is lost before a job is processed, the job is lost. Use `appendonly yes` and AOF persistence in production Redis.

## Extraction Path

If throughput grows beyond ~10,000 jobs/second or fan-out to independent services is required, see `docs/EXTRACTION.md` for the migration path to Kafka. The BullMQ queue names map cleanly to Kafka topics; the worker processor functions are transport-agnostic.
