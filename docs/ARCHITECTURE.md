# Architecture

## Overview

Orderly is a **modular monolith** with explicit extraction boundaries. All modules share a single deployment unit but are internally decoupled via interfaces and dependency injection.

## Component Diagram

```
┌────────────────────────────────────────────────────────────────┐
│  Public API  :3000              Admin API  :3001                │
│  Fastify v5                     Fastify v5                      │
│  ─ POST /api/v1/orders          ─ GET  /admin/v1/dlq            │
│  ─ GET  /api/v1/orders/:id      ─ POST /admin/v1/dlq/retry/:id  │
│  ─ GET  /api/v1/orders/:id/saga ─ GET  /admin/v1/sagas          │
│  ─ GET  /health[/deep]          ─ POST /admin/v1/sagas/:id/comp │
└──────────────┬─────────────────────────────────────────────────┘
               │ (DI — injected services, no new() inside handlers)
┌──────────────▼──────────────────────────────────────────────────┐
│  Domain Layer                                                    │
│                                                                  │
│  OrderService           SagaOrchestrator                         │
│    - createOrder()         - startSaga()    ← RUNNING            │
│    - getOrder()            - compensate()   ← COMPENSATING       │
│                                                                  │
│  InventoryService       PaymentService                           │
│    - reserveInventory()    - charge()                            │
│    - releaseInventory()    - refund()                            │
│                                                                  │
│  Value Objects: Money (decimal.js), SKU                         │
│  Entities:      Order, OrderItem, SagaInstance, SagaStep        │
│  Transitions:   Pure functions, return new objects (immutable)  │
└──────┬──────────────────────────────────────────────────────────┘
       │ interfaces (IOrderRepository, IInventoryRepository, etc.)
┌──────▼──────────────────────────────────────────────────────────┐
│  Infrastructure Layer                                            │
│                                                                  │
│  PostgreSQL (postgres.js)    Redis (ioredis)                     │
│  ├─ OrderRepository           ├─ IdempotencyStore (24h TTL)      │
│  ├─ SagaRepository            └─ RateLimiter (token bucket)      │
│  ├─ InventoryRepository                                          │
│  └─ OutboxRepository          BullMQ Queues                     │
│                               ├─ payment-processing              │
│  PostgresAdvisoryLock          ├─ inventory-release              │
│  (implements LockManager)     └─ webhook-delivery                │
│                                                                  │
│  StripeAdapter                OutboxProcessor                    │
│  (implements PaymentGateway)  (polls every 500ms)               │
│                                                                  │
│  cockatiel ResiliencePolicy   WebhookDispatcher                  │
│  (CircuitBreaker + Retry)     (HMAC-SHA256, SSRF guard)         │
└──────────────────────────────────────────────────────────────────┘
```

## Saga Flow

```
POST /api/v1/orders
       │
       ├─► Write order + outbox event (single SQL transaction)
       │   └─► HTTP 201 returned immediately
       │
       └─► Saga starts asynchronously
              │
              ├─► Step 1: RESERVE_INVENTORY
              │     PostgreSQL advisory lock per SKU (sorted α to prevent deadlock)
              │     UPDATE inventory ... WHERE quantity_available >= requested
              │
              ├─► Step 2: PROCESS_PAYMENT
              │     cockatiel: RetryPolicy (3× exponential) inside CircuitBreaker
              │     StripeAdapter.charge()
              │
              ├─► Step 3: CONFIRM_ORDER
              │     UPDATE orders SET status = 'PAID'
              │
              └─► Step 4: EMIT_EVENTS
                    Write order.paid to outbox_events
                    OutboxProcessor picks it up within 500ms
                    BullMQ webhook-delivery → WebhookDispatcher
```

## Compensation Flow

On any step failure (insufficient stock, payment declined, etc.):

```
startCompensation(saga) → status = COMPENSATING
      │
      ├─► Refund payment (only if PROCESS_PAYMENT step completed)
      ├─► Release inventory (reverse reservation)
      ├─► Cancel order (status = CANCELLED)
      └─► Write order.failed to outbox → webhook delivery
```

## Key Design Decisions

| Decision          | Choice                      | Why                                    |
| ----------------- | --------------------------- | -------------------------------------- |
| Money arithmetic  | decimal.js                  | Exact decimal, no IEEE 754 drift       |
| Inventory locking | PostgreSQL advisory locks   | Single service, no clock skew          |
| Event delivery    | Transactional Outbox        | Atomic write, at-least-once guarantee  |
| Queue             | BullMQ                      | Retry, DLQ, delay, rate limit built-in |
| DI                | Constructor injection       | Testable, no framework magic           |
| State mutations   | Pure functions, new objects | No accidental mutation bugs            |

## Extraction Boundaries

See `docs/EXTRACTION.md` for the full extraction plan. Short version:

- **Payment Worker** → `payment-processor` service: change BullMQ consumer to HTTP/gRPC endpoint
- **Notification Worker** → `webhook-delivery` service: same approach
- **Inventory Service** → `inventory-service`: swap `PostgresAdvisoryLock` for `RedisRedlock`
