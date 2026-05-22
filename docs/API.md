# API Reference

## Base URLs

| Environment | Public API                    | Admin API               |
| ----------- | ----------------------------- | ----------------------- |
| Development | `http://localhost:3000`       | `http://localhost:3001` |
| Production  | `https://api.your-domain.com` | Internal only           |

## Authentication

**Public API:** No authentication required. Rate limiting is enforced per `X-Client-ID` header.

**Admin API:** Requires `X-API-Key` header with the value of `ADMIN_API_KEY` environment variable.

---

## Public API

### POST /api/v1/orders

Create an order. This endpoint is **idempotent** — supplying the same `Idempotency-Key` with an identical request body returns the original response.

**Required headers:**

| Header            | Description                         |
| ----------------- | ----------------------------------- |
| `Idempotency-Key` | UUID v4 for deduplication (24h TTL) |
| `X-Client-ID`     | Client identifier for rate limiting |
| `Content-Type`    | `application/json`                  |

**Request body:**

```json
{
  "customerId": "cust-001",
  "items": [
    {
      "sku": "WIDGET-1",
      "quantity": 2,
      "unitPrice": "29.99"
    }
  ],
  "currency": "USD",
  "paymentToken": "tok_visa_test"
}
```

| Field               | Type    | Rules                                          |
| ------------------- | ------- | ---------------------------------------------- |
| `customerId`        | string  | 1–64 characters                                |
| `items`             | array   | 1–50 items                                     |
| `items[].sku`       | string  | 1–64 chars, alphanumeric + hyphens/underscores |
| `items[].quantity`  | integer | 1–1000                                         |
| `items[].unitPrice` | string  | Format: `"29.99"` (two decimal places)         |
| `currency`          | string  | 3-letter ISO code (default: `"USD"`)           |
| `paymentToken`      | string  | 1–512 characters                               |

**Responses:**

`201 Created` — Order accepted and processing started.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "customerId": "cust-001",
  "status": "PENDING",
  "totalAmount": { "amount": "59.98", "currency": "USD" },
  "items": [
    { "id": "...", "sku": "WIDGET-1", "quantity": 2, "unitPrice": "29.99" }
  ],
  "createdAt": "2026-05-15T10:00:00.000Z",
  "updatedAt": "2026-05-15T10:00:00.000Z"
}
```

`400 Bad Request` — Missing `Idempotency-Key` or `X-Client-ID` header.

`409 Conflict` — `Idempotency-Key` used with a different request body.

`422 Unprocessable Entity` — Validation failure (field-level errors included).

`429 Too Many Requests` — Rate limit exceeded. Includes `Retry-After` header.

`503 Service Unavailable` — Queue depth > 10,000. Includes `Retry-After` header.

All error responses use [RFC 7807](https://tools.ietf.org/html/rfc7807) `application/problem+json`:

```json
{
  "type": "https://orderly.example.com/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "The request body contains invalid data.",
  "errors": [
    {
      "field": "items.0.unitPrice",
      "message": "unitPrice must be in format \"29.99\""
    }
  ]
}
```

---

### GET /api/v1/orders/:id

Retrieve an order by its UUID.

**Response `200 OK`:** Same shape as the `POST` 201 response above, with potentially different `status`.

**Order status values:**

| Status         | Description              |
| -------------- | ------------------------ |
| `PENDING`      | Accepted, saga running   |
| `PAID`         | Payment confirmed        |
| `FULFILLED`    | Picked and packed        |
| `SHIPPED`      | In transit               |
| `CANCELLED`    | Cancelled or compensated |
| `COMPENSATING` | Compensation in progress |

**Response `404 Not Found`:** Order not found.

---

### GET /api/v1/orders/:id/saga

Retrieve the full saga execution history for debugging.

**Response `200 OK`:**

```json
{
  "id": "saga-uuid",
  "orderId": "order-uuid",
  "status": "COMPLETED",
  "currentStep": 3,
  "startedAt": "2026-05-15T10:00:00.000Z",
  "completedAt": "2026-05-15T10:00:02.341Z",
  "steps": [
    {
      "id": "step-uuid",
      "stepName": "RESERVE_INVENTORY",
      "stepOrder": 0,
      "status": "COMPLETED",
      "errorMessage": null,
      "startedAt": "2026-05-15T10:00:00.100Z",
      "completedAt": "2026-05-15T10:00:00.145Z"
    }
  ]
}
```

---

### GET /health

Shallow health check. Always returns `200 OK` if the process is alive. Used by load balancer liveness probes.

```json
{ "status": "ok", "timestamp": "2026-05-15T10:00:00.000Z" }
```

### GET /api/v1/health/deep

Deep health check: PostgreSQL, Redis, queue depth, memory.

Returns `200` with `status: "ok"` if all systems healthy.
Returns `503` if PostgreSQL is unreachable or queue depth > 10,000.

```json
{
  "status": "ok",
  "timestamp": "2026-05-15T10:00:00.000Z",
  "checks": {
    "postgres": { "status": "ok", "latencyMs": 2 },
    "redis": { "status": "ok", "latencyMs": 1 },
    "queue": {
      "status": "warning",
      "latencyMs": 0,
      "detail": "Total pending jobs: 5200 (warn>5000, critical>10000)"
    },
    "memory": {
      "status": "ok",
      "latencyMs": 0,
      "detail": "128MB / 512MB (25%)"
    }
  }
}
```

---

## Admin API

All admin endpoints require the `X-API-Key` header.

### GET /admin/v1/dlq

List failed jobs across all queues.

**Query params:**

- `limit` (default `50`, max `200`)
- `queue` (filter to one queue: `payment-processing`, `inventory-release`, `webhook-delivery`)

**Response `200 OK`:**

```json
{
  "total": 2,
  "jobs": [
    {
      "jobId": "123",
      "queue": "payment-processing",
      "name": "order.created",
      "data": { "orderId": "..." },
      "failedReason": "Payment failed: card_declined",
      "attemptsMade": 5,
      "timestamp": "2026-05-15T10:00:00.000Z",
      "processedOn": "2026-05-15T10:00:05.000Z",
      "finishedOn": "2026-05-15T10:01:00.000Z"
    }
  ]
}
```

### POST /admin/v1/dlq/retry/:jobId

Re-queue a failed job. Optional `?queue=` param to target a specific queue.

**Response `200 OK`:** `{ "message": "Job 123 re-queued in payment-processing" }`

### DELETE /admin/v1/dlq/:jobId

Permanently remove a failed job.

### GET /admin/v1/sagas?olderThanMinutes=10

List sagas in RUNNING or COMPENSATING state older than threshold.

### GET /admin/v1/sagas/:id

Full saga detail with all step history, input/output payloads, and compensation status.

### POST /admin/v1/sagas/:id/compensate

Trigger manual compensation for a RUNNING saga. Returns `409` if the saga is not in `RUNNING` state.

---

## Rate Limiting

Token bucket per `X-Client-ID`, 100 requests per 60 seconds.

Response headers on every request:

| Header                  | Description                           |
| ----------------------- | ------------------------------------- |
| `X-RateLimit-Limit`     | Max requests per window               |
| `X-RateLimit-Remaining` | Requests remaining in current window  |
| `X-RateLimit-Reset`     | ISO 8601 timestamp when window resets |

When exceeded:

- HTTP `429` with `Retry-After` header (seconds)
- Redis-backed; fails open (allows request) if Redis is unavailable

---

## Idempotency Details

| Scenario                              | Result                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| First request                         | Processed normally; response cached for 24h                  |
| Replay (same key + same body)         | Cached response returned; `X-Idempotent-Replay: true` header |
| Collision (same key + different body) | `409 Conflict`                                               |
| Expired key (> 24h)                   | Treated as first request                                     |

---

## OpenAPI Specification

Auto-generated OpenAPI 3.1 spec is served at `GET /docs` (development only).
