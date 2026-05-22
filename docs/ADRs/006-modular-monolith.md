# ADR-006: Modular Monolith over Microservices

**Status:** Accepted  
**Date:** 2026-05-15

## Context

The system demonstrates distributed systems patterns (saga, outbox, circuit breaker, DLQ) that are typically found in microservice architectures. However, this is a single-engineer project where operational complexity should be minimised without sacrificing architectural quality.

## Decision

Build a **modular monolith** — a single deployable unit with clear internal module boundaries that mirror future service boundaries.

## Alternatives Considered

### Microservices from the start

**Rejected.** Reasons:

- Single engineer cannot efficiently operate multiple services, databases, and deployment pipelines
- Network partitions between services add failure modes that obscure the core patterns being demonstrated
- Premature decomposition leads to distributed monolith anti-pattern

### Pure monolith (no internal boundaries)

**Rejected.** Without clear module boundaries, extraction to microservices later would require a full rewrite. The modular approach preserves extraction readiness.

## Consequences

**Positive:**

- Single codebase, single test suite, single deployment — maximum development velocity
- One container to monitor, scale, and debug
- Internal module boundaries (`domain/`, `infrastructure/`, `api/`) mirror future service boundaries
- Each module can be extracted to a standalone service with minimal logic changes
- All distributed patterns (saga, outbox, circuit breaker) are fully demonstrated within the monolith

**Negative:**

- Does not demonstrate real network partition handling between services
- Cannot independently scale individual modules (e.g. payment processing)
- Single process failure takes down all functionality

## Extraction Boundaries

Documented in `docs/EXTRACTION.md`:

- `src/domain/services/payment-service.ts` → Future `payment-processor` service
- `src/infrastructure/queue/workers/payment-worker.ts` → Future worker entrypoint
- `src/events/webhooks/` → Future `webhook-delivery` service

## When to Extract

- Payment processing needs independent scaling
- Different teams own different domains
- Webhook delivery requires separate SLOs
