# Orderly

**Production-grade event-driven order service** demonstrating senior backend engineering patterns: Saga orchestration, Transactional Outbox, PostgreSQL advisory locks, circuit breaker, idempotency, and full observability.

---

## Architecture at a Glance

```
Client → Fastify API → PostgreSQL (order + outbox, atomic)
                    ↓
              BullMQ Workers (payment, inventory, notification)
                    ↓
              WebhookDispatcher → External subscribers
```

**Key patterns:**

- **Saga (Orchestrated)** — distributed transaction with full compensation
- **Transactional Outbox** — atomic order + event write, at-least-once delivery
- **Advisory Locks** — zero-overselling inventory reservation (PostgreSQL session locks)
- **Circuit Breaker** — cockatiel `CircuitBreakerPolicy` + `RetryPolicy` protecting payment gateway
- **Idempotency** — Redis-backed, SHA-256 body hash, 24h TTL, 409 on key collision
- **RFC 7807** — all error responses are `application/problem+json`

---

## Quick Start

### Prerequisites

- Node.js ≥ 24, pnpm ≥ 10
- Docker + Docker Compose

### One-command start

```bash
cp .env.example .env
docker-compose up --build
```

API: http://localhost:3000  
Admin: http://localhost:3001  
Docs (Swagger UI): http://localhost:3000/docs

### Manual start

```bash
pnpm install
cp .env.example .env           # Fill in DATABASE_URL and REDIS_URL
pnpm run migrate               # Run PostgreSQL migrations
pnpm run seed                  # Seed inventory (optional)
pnpm run dev                   # Start with hot-reload
```

---

## API Reference

### Create Order

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Client-ID: my-app" \
  -d '{
    "customerId": "cust-001",
    "items": [{"sku": "WIDGET-1", "quantity": 2, "unitPrice": "29.99"}],
    "currency": "USD",
    "paymentToken": "tok_visa_test"
  }'
```

### Get Order

```bash
curl http://localhost:3000/api/v1/orders/{id}
```

### Get Saga (debug)

```bash
curl http://localhost:3000/api/v1/orders/{id}/saga
```

### Admin: List DLQ

```bash
curl -H "X-API-Key: dev-admin-key" http://localhost:3001/admin/v1/dlq
```

### Admin: Retry DLQ Job

```bash
curl -X POST -H "X-API-Key: dev-admin-key" \
  "http://localhost:3001/admin/v1/dlq/retry/{jobId}?queue=payment-processing"
```

---

## Testing

```bash
# Unit tests (domain logic, no I/O)
pnpm run test:unit

# Unit tests with coverage (enforces 90% domain coverage)
pnpm run test:coverage

# Integration tests (real PostgreSQL via Testcontainers)
pnpm run test:integration

# All tests
pnpm run test
```

### Load test (requires k6)

```bash
pnpm run seed                  # Seed inventory first
k6 run tests/load/flash-sale.js
```

---

## Performance

**Single instance benchmarks** (run `k6` and results are written to `docs/PERFORMANCE.md`):

| Metric                          | SLO                | Notes                                   |
| ------------------------------- | ------------------ | --------------------------------------- |
| p99 order acceptance            | < 150ms            | Measured from request to `201` response |
| p50 order acceptance            | < 30ms             |                                         |
| Throughput (1 instance, 4 vCPU) | ~200 rps sustained | Scale horizontally for higher load      |
| End-to-end processing           | < 5 minutes p99    | Saga completion time                    |

> **Scaling to 1,000 rps** requires horizontal API + worker pod scaling (stateless). The queue and DB remain single-writer; Redis Cluster handles queue throughput at that scale.

---

## Project Structure

```
src/
├── api/              Fastify routes, middleware, schemas
├── domain/           Entities, value objects, repositories (interfaces), services
├── infrastructure/   Concrete implementations: DB, Redis, queues, payment, locking
└── events/           Outbox processor, webhook dispatcher
tests/
├── unit/             Pure domain logic (no I/O)
├── integration/      Real DB/Redis (Testcontainers)
├── e2e/              Full lifecycle tests
└── load/             k6 flash-sale scenario
migrations/           Versioned SQL migrations
docs/                 Architecture, API, runbooks, ADRs
```

---

## Design Decisions

**Why modular monolith over microservices?**  
Extraction boundaries are explicit (see `docs/EXTRACTION.md`). Payment and notification workers are already isolated — the only change needed to extract them is replacing the BullMQ transport with HTTP/gRPC.

**Why BullMQ over RabbitMQ?**  
BullMQ provides built-in retry, DLQ, priority, delayed jobs, and rate limiting without broker configuration overhead. The trade-off (Redis single-writer bottleneck above ~10k jobs/sec) is documented in ADR-002. RabbitMQ would add value only when multi-consumer fan-out or AMQP interoperability is needed.

**Why PostgreSQL advisory locks over Redis Redlock?**  
Single-service scope means no clock skew or split-brain risk. The `LockManager` interface allows swapping to Redlock when the inventory service extracts.

**Why postgres.js over Prisma?**  
Maximum query control and zero ORM overhead. `FOR UPDATE SKIP LOCKED` on the outbox, bulk item inserts, and advisory lock calls are explicit SQL — not ORM workarounds.

---

## Environment Variables

See `.env.example` for the full reference. Required in production:

- `DATABASE_URL`
- `REDIS_URL`
- `ADMIN_API_KEY` (default `dev-admin-key` is **rejected** in non-development environments)
- `PAYMENT_GATEWAY_API_KEY`

---

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Runbooks](docs/RUNBOOKS.md)
- [ADRs](docs/ADRs/)
- [Performance](docs/PERFORMANCE.md) ← generated by k6
