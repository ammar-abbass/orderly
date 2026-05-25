# Orderly — Manual Testing Guide

This guide provides `curl` commands to manually test all the critical flows, edge cases, and resilience patterns we implemented in the `orderly_v2` project.

Ensure the service is running locally (`docker compose up --build -d` or `pnpm dev` with backing services).
The base URL is `http://localhost:3000`.

---

## 1. Happy Path: Successful Order & Saga

Place a standard order with valid inventory and payment. The saga will reserve inventory, charge the card, and mark the order as `PAID`.

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: happy-path-001" \
  -H "X-Client-ID: client-1" \
  -d '{
    "customerId": "cust_123",
    "items": [
      { "sku": "WIDGET-1", "quantity": 2, "unitPrice": "29.99" }
    ],
    "paymentToken": "tok_visa"
  }'
```

_Expected Result:_ `202 Accepted` with the `orderId`. The saga will complete asynchronously.

## 2. Idempotency Check

Run the **exact same command** above again with the same `Idempotency-Key`.

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: happy-path-001" \
  -H "X-Client-ID: client-1" \
  -d '{
    "customerId": "cust_123",
    "items": [
      { "sku": "WIDGET-1", "quantity": 2, "unitPrice": "29.99" }
    ],
    "paymentToken": "tok_visa"
  }'
```

_Expected Result:_ `200 OK` (or `202 Accepted`) returning the exact same `orderId` instantly without triggering a new saga or double-charging.

## 3. Compensation / Rollback: Inventory Failure

Try to order a product that is out of stock (e.g., `WIDGET-OOS`), or request more quantity than available (e.g., 50000 of `WIDGET-2`).

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: out-of-stock-001" \
  -H "X-Client-ID: client-1" \
  -d '{
    "customerId": "cust_123",
    "items": [
      { "sku": "WIDGET-OOS", "quantity": 1, "unitPrice": "99.99" }
    ],
    "paymentToken": "tok_visa"
  }'
```

_Expected Result:_ The API will accept the order (`202 Accepted`), but the saga worker will fail the `RESERVE_INVENTORY` step, immediately transition the order to `CANCELLED`, and halt the saga. You can verify this by checking the database `orders` table.

## 4. Compensation / Rollback: Payment Failure

Order valid inventory, but provide a payment token that triggers a decline (e.g., `tok_charge_failed`).

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: payment-fail-001" \
  -H "X-Client-ID: client-1" \
  -d '{
    "customerId": "cust_123",
    "items": [
      { "sku": "WIDGET-1", "quantity": 1, "unitPrice": "29.99" }
    ],
    "paymentToken": "tok_charge_failed"
  }'
```

_Expected Result:_

1. API returns `202 Accepted`.
2. Saga reserves inventory successfully.
3. Payment step fails.
4. Saga triggers compensation: it releases the inventory reservation and marks the order as `CANCELLED`.

## 5. Circuit Breaker Simulation

Send multiple payment failures rapidly to trip the circuit breaker.
Run this command 5-10 times quickly:

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: circuit-breaker-$RANDOM" \
  -H "X-Client-ID: client-1" \
  -d '{
    "customerId": "cust_123",
    "items": [
      { "sku": "WIDGET-3", "quantity": 1, "unitPrice": "59.99" }
    ],
    "paymentToken": "tok_charge_failed"
  }'
```

_Expected Result:_ After several failures, the payment service will immediately reject new requests with a `Circuit breaker is open` error, skipping the external gateway entirely, allowing the system to shed load and recover.

## 6. Rate Limiting

The API restricts orders to 10 requests per minute per IP. Run this loop to hit the rate limiter:

```bash
for i in {1..12}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" -X POST http://localhost:3000/api/v1/orders \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: rate-limit-test-$i" \
    -H "X-Client-ID: client-1" \
    -d '{"customerId": "cust_123", "items": [{"sku": "WIDGET-1", "quantity": 1, "unitPrice": "29.99"}], "paymentToken": "tok_visa"}'
done
```

_Expected Result:_ The first 10 requests will return `202`, and the 11th and 12th requests will return `429 Too Many Requests` (following RFC 7807 problem details format).

## 7. Deep Health Check

Verify all connections (Redis, Postgres, BullMQ) are healthy.

```bash
curl http://localhost:3000/health/ready
```

_Expected Result:_ `200 OK` with a JSON payload showing `status: "ok"` and detailed checks for DB and Queue.
