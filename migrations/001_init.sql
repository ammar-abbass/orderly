-- ─────────────────────────────────────────────────────────────────────────────
-- 001_init.sql  — Orderly baseline schema
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE order_status AS ENUM (
  'PENDING', 'PAID', 'FULFILLED', 'SHIPPED', 'CANCELLED', 'COMPENSATING'
);

CREATE TYPE saga_status AS ENUM (
  'PENDING', 'RUNNING', 'COMPLETED', 'COMPENSATING', 'FAILED'
);

CREATE TYPE outbox_status AS ENUM (
  'PENDING', 'PUBLISHED', 'FAILED'
);

-- ── Orders ────────────────────────────────────────────────────────────────────

CREATE TABLE orders (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id      VARCHAR(64)    NOT NULL,
  status           order_status   NOT NULL DEFAULT 'PENDING',
  -- NUMERIC(12,2): exact decimal, preferred over DECIMAL for PostgreSQL
  total_amount     NUMERIC(12,2)  NOT NULL,
  currency         CHAR(3)        NOT NULL DEFAULT 'USD',
  idempotency_key  VARCHAR(255)   UNIQUE,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id          UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID           NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku         VARCHAR(64)    NOT NULL,
  quantity    INT            NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(12,2)  NOT NULL
);

-- ── Inventory ─────────────────────────────────────────────────────────────────

CREATE TABLE inventory (
  sku                 VARCHAR(64)  PRIMARY KEY,
  quantity_available  INT          NOT NULL CHECK (quantity_available >= 0),
  quantity_reserved   INT          NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  version             INT          NOT NULL DEFAULT 1  -- Optimistic lock fallback
);

-- ── Sagas ─────────────────────────────────────────────────────────────────────

CREATE TABLE saga_instances (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID          NOT NULL REFERENCES orders(id),
  type          VARCHAR(64)   NOT NULL DEFAULT 'ORDER_FULFILLMENT',
  status        saga_status   NOT NULL DEFAULT 'PENDING',
  current_step  INT           NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  metadata      JSONB         NOT NULL DEFAULT '{}'
);

CREATE TABLE saga_steps (
  id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  saga_id              UUID          NOT NULL REFERENCES saga_instances(id) ON DELETE CASCADE,
  step_name            VARCHAR(64)   NOT NULL,
  step_order           INT           NOT NULL,
  status               VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
  input_payload        JSONB,
  output_payload       JSONB,
  error_message        TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  compensation_status  VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
  compensation_error   TEXT
);

-- ── Outbox ────────────────────────────────────────────────────────────────────

CREATE TABLE outbox_events (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_type  VARCHAR(64)    NOT NULL,
  aggregate_id    VARCHAR(64)    NOT NULL,
  event_type      VARCHAR(64)    NOT NULL,
  payload         JSONB          NOT NULL,
  headers         JSONB          NOT NULL DEFAULT '{}',
  status          outbox_status  NOT NULL DEFAULT 'PENDING',
  retry_count     INT            NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);

-- ── Webhooks ──────────────────────────────────────────────────────────────────

CREATE TABLE webhook_subscriptions (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  url          VARCHAR(512)  NOT NULL,
  event_types  TEXT[]        NOT NULL,
  secret       VARCHAR(255)  NOT NULL,
  active       BOOLEAN       NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_deliveries (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id  UUID         NOT NULL REFERENCES webhook_subscriptions(id),
  -- event_id references the aggregate_id string (not a FK to avoid coupling)
  event_id         VARCHAR(64)  NOT NULL,
  status           INT          NOT NULL,  -- HTTP status, or -1 for network error
  response_body    TEXT,
  attempted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
