# Extraction Guide

Orderly is a modular monolith with explicit extraction boundaries. This document describes how to split each module into a standalone service with **zero domain logic changes**.

## Payment Worker → `payment-processor` Service

**Files to move:**
- `src/domain/services/payment-service.ts`
- `src/infrastructure/payment/`
- `src/infrastructure/queue/workers/payment-worker.ts`

**Transport change:**
- Current: BullMQ consumer on `payment-processing` queue
- After: HTTP endpoint `POST /internal/payments/charge`
- The SagaOrchestrator calls `paymentService.charge()` — swap the implementation to an HTTP client

**Interface unchanged:** `PaymentGateway` and `PaymentService` contracts do not change.

---

## Notification Worker → `webhook-delivery` Service

**Files to move:**
- `src/events/webhooks/`
- `src/infrastructure/queue/workers/notification-worker.ts`

**Transport change:**
- Current: BullMQ consumer on `webhook-delivery` queue
- After: HTTP endpoint `POST /internal/webhooks/dispatch`

---

## Inventory Service → `inventory-service` Service

**Files to move:**
- `src/domain/services/inventory-service.ts`
- `src/domain/repositories/inventory-repository.ts`
- `src/infrastructure/locking/`

**Transport change:**
- Current: In-process `InventoryService` calls
- After: HTTP `POST /internal/inventory/reserve` and `POST /internal/inventory/release`

**Lock change:**
- Current: `PostgresAdvisoryLock` (session-scoped, in-process)
- After: `RedisRedlock` (cross-service mutual exclusion)
- Change is a **single swap** in the composition root: `new RedisRedlock(redis)` instead of `new PostgresAdvisoryLock()`

---

## Estimated extraction effort

| Module | Effort | Risk |
|--------|--------|------|
| Notification worker | 1 day | Low — already isolated |
| Payment worker | 2 days | Medium — circuit breaker singleton must remain per-service |
| Inventory service | 3 days | Medium — lock swap + distributed DB split |
