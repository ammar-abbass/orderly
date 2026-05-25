-- ─────────────────────────────────────────────────────────────────────────────
-- 002_add_indexes.sql — Performance-critical indexes
-- See SPEC §8.2 for index strategy rationale.
-- ─────────────────────────────────────────────────────────────────────────────

-- Hot path: Idempotency lookup on every POST /orders
CREATE UNIQUE INDEX idx_orders_idempotency
  ON orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Hot path: Outbox polling every 500ms
CREATE INDEX idx_outbox_pending
  ON outbox_events(status, created_at)
  WHERE status = 'PENDING';

-- Hot path: Saga recovery after worker crashes
CREATE INDEX idx_saga_running
  ON saga_instances(status, started_at)
  WHERE status IN ('RUNNING', 'COMPENSATING');

-- Customer order history
CREATE INDEX idx_orders_customer
  ON orders(customer_id, created_at DESC);

-- Inventory lookups (sku is PK, this is belt-and-suspenders for multi-column queries)
CREATE INDEX idx_order_items_order_id
  ON order_items(order_id);

-- Saga → steps lookup
CREATE INDEX idx_saga_steps_saga_id
  ON saga_steps(saga_id, step_order);

-- Webhook deliveries by subscription
CREATE INDEX idx_webhook_deliveries_subscription
  ON webhook_deliveries(subscription_id, attempted_at DESC);

-- Active webhook subscriptions by event type (GIN for array containment)
CREATE INDEX idx_webhook_subscriptions_event_types
  ON webhook_subscriptions USING GIN(event_types)
  WHERE active = true;
