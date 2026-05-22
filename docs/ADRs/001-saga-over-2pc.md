# ADR-001: Saga Pattern over Two-Phase Commit

**Status:** Accepted  
**Date:** 2026-05-15
**Authors:** Ammar Abbas

## Context

Order creation involves two distinct operations that must be atomic:

1. Inventory reservation
2. Payment charge via an external HTTP API

We need a strategy that guarantees consistency across these two systems without leaving the system in a permanently inconsistent state when either operation fails.

## Decision

Use the **Orchestrated Saga** pattern with the **Transactional Outbox** for event publishing.

## Alternatives Considered

### Two-Phase Commit (2PC)

**Rejected.** Reasons:

- The payment gateway does not support distributed transaction coordination protocols
- 2PC holds database locks for the full duration of the payment HTTP call (Locks resources during the entire transaction, potentially seconds), severely limiting throughput
- Coordinator failure leaves participants in an uncertain "prepared" state indefinitely
- PostgreSQL supports 2PC but the operational burden is high

### Choreography-based Saga

**Rejected** in favour of orchestration. Reasons:

- Event chains are harder to observe and reason about — debugging requires reconstructing the event sequence across multiple consumers
- Adding a new step requires modifying multiple services
- The orchestrated approach gives a single place (`SagaOrchestrator`) to read the complete state of any transaction

### TCC (Try-Confirm-Cancel)

**Rejected** due to complexity of implementing Try semantics in payment gateways

## Consequences

**Positive:**

- System is eventually consistent — if a step fails, compensation restores previous state
- Each step is a local transaction — no distributed locking required
- Full observability: `saga_instances` + `saga_steps` tables provide a complete audit log
- Manual recovery via Admin API without code deploys

**Negative:**

- Eventual consistency means there is a brief window where the order is PENDING but not yet paid
- Compensation logic must be written and maintained for each step
- "Saga in COMPENSATING state" requires runbook documentation for on-call engineers

## Compensation Guarantee

The system guarantees:

- If `PROCESS_PAYMENT` completed with a `transactionId`, a refund is always attempted
- If `RESERVE_INVENTORY` completed, inventory is always released
- The order is always transitioned to `CANCELLED` on compensation

The only case where automatic recovery fails is if the refund call also fails (e.g. gateway is down for > 24h). This is documented in Runbook R4 and triggers a `payment.refund_failed` alert.
