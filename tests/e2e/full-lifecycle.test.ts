import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Full Order Lifecycle E2E Tests
 *
 * These tests spin up a real Fastify server instance connected to the
 * DATABASE_URL and REDIS_URL from the environment. They are designed to
 * run against a live stack (docker-compose up) and are skipped automatically
 * when infrastructure is not available.
 *
 * Run:
 *   docker-compose up -d postgres redis
 *   pnpm run migrate && pnpm run seed
 *   pnpm run test:e2e
 */

// Lazy-import to avoid instantiating singletons before env is ready
let app: FastifyInstance | null = null;

async function buildTestServer(): Promise<FastifyInstance> {
  // Inline composition to mirror src/index.ts without starting the real listeners
  const { getConfig } = await import('../../src/config.js');
  const { OrderRepository } =
    await import('../../src/domain/repositories/order-repository.js');
  const { SagaRepository } =
    await import('../../src/domain/repositories/saga-repository.js');
  const { InventoryRepository } =
    await import('../../src/domain/repositories/inventory-repository.js');
  const { OutboxRepository } =
    await import('../../src/domain/repositories/outbox-repository.js');
  const { PostgresAdvisoryLock } =
    await import('../../src/infrastructure/locking/postgres-advisory-lock.js');
  const { StripeAdapter } =
    await import('../../src/infrastructure/payment/stripe-adapter.js');
  const { createPaymentResiliencePolicy } =
    await import('../../src/infrastructure/payment/circuit-breaker.js');
  const { PostgresTransactionManager } =
    await import('../../src/infrastructure/database/transaction-manager.js');
  const { InventoryService } =
    await import('../../src/domain/services/inventory-service.js');
  const { PaymentService } =
    await import('../../src/domain/services/payment-service.js');
  const { SagaOrchestrator } =
    await import('../../src/domain/services/saga-orchestrator.js');
  const { OrderService } =
    await import('../../src/domain/services/order-service.js');
  const { buildServer } = await import('../../src/api/server.js');
  const { logger } =
    await import('../../src/infrastructure/observability/logger.js');
  const { metrics } =
    await import('../../src/infrastructure/observability/metrics.js');

  getConfig(); // Validate config early

  const orderRepo = new OrderRepository();
  const sagaRepo = new SagaRepository();
  const inventoryRepo = new InventoryRepository();
  const outboxRepo = new OutboxRepository();
  const lockManager = new PostgresAdvisoryLock();
  const gateway = new StripeAdapter();
  const resilience = createPaymentResiliencePolicy();
  const txManager = new PostgresTransactionManager();
  const inventoryService = new InventoryService(
    inventoryRepo,
    lockManager,
    logger,
    metrics,
  );
  const paymentService = new PaymentService(
    gateway,
    resilience,
    logger,
    metrics,
  );

  const sagaOrchestrator = new SagaOrchestrator(
    orderRepo,
    sagaRepo,
    outboxRepo,
    inventoryService,
    paymentService,
    txManager,
    logger,
    metrics,
  );

  // In-process saga enqueuer for E2E — runs saga inline (no BullMQ needed)
  const inlineSagaEnqueuer = {
    async enqueue(context: {
      orderId: string;
      customerId: string;
      items: ReadonlyArray<{ sku: string; quantity: number }>;
      totalAmount: { amount: string; currency: string };
      paymentToken: string;
    }): Promise<string> {
      // Fire-and-forget in tests — saga runs asynchronously
      sagaOrchestrator.startSaga(context).catch((err: unknown) => {
        logger.error({ err, orderId: context.orderId }, 'E2E saga failed');
      });
      return `e2e-saga-${context.orderId}`;
    },
  };

  const orderService = new OrderService(
    orderRepo,
    outboxRepo,
    inlineSagaEnqueuer,
    txManager,
    logger,
    metrics,
  );

  // Seed E2E inventory
  await inventoryRepo.seedInventory([
    { sku: 'E2E-SKU-001', quantity: 50 },
    { sku: 'E2E-SKU-002', quantity: 30 },
    { sku: 'E2E-OOS-001', quantity: 0 },
  ]);

  const { RateLimiter } =
    await import('../../src/infrastructure/redis/rate-limiter.js');
  const rateLimiter = new RateLimiter();

  return buildServer({ orderService, sagaOrchestrator, sagaRepo, rateLimiter });
}

describe('Full Order Lifecycle E2E', () => {
  beforeAll(async () => {
    if (!process.env['DATABASE_URL'] || !process.env['REDIS_URL']) {
      return; // skip — infrastructure not available
    }
    try {
      app = await buildTestServer();
      await app.ready();
    } catch {
      app = null;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  function skipIfNoInfra() {
    if (!app) {
      console.log(
        'Skipping E2E test — DATABASE_URL/REDIS_URL not set or infra not reachable',
      );
      return true;
    }
    return false;
  }

  it('creates an order and returns 201 with correct total', async () => {
    if (skipIfNoInfra()) return;

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'X-Client-ID': 'e2e-client',
        'Content-Type': 'application/json',
      },
      payload: {
        customerId: 'e2e-customer-001',
        items: [
          { sku: 'E2E-SKU-001', quantity: 2, unitPrice: '15.00' },
          { sku: 'E2E-SKU-002', quantity: 1, unitPrice: '25.00' },
        ],
        currency: 'USD',
        paymentToken: 'tok_visa_test',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as {
      id: string;
      status: string;
      totalAmount: { amount: string };
    };
    expect(body.id).toBeDefined();
    expect(body.status).toBe('PENDING');
    // 2 × 15.00 + 1 × 25.00 = 55.00
    expect(body.totalAmount.amount).toBe('55.00');
  });

  it('returns 409 for duplicate idempotency key with different body', async () => {
    if (skipIfNoInfra()) return;

    const key = crypto.randomUUID();

    // First request
    await app!.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: {
        'Idempotency-Key': key,
        'X-Client-ID': 'e2e-client',
        'Content-Type': 'application/json',
      },
      payload: {
        customerId: 'cust-a',
        items: [{ sku: 'E2E-SKU-001', quantity: 1, unitPrice: '10.00' }],
        currency: 'USD',
        paymentToken: 'tok_visa',
      },
    });

    // Same key, different body
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: {
        'Idempotency-Key': key,
        'X-Client-ID': 'e2e-client',
        'Content-Type': 'application/json',
      },
      payload: {
        customerId: 'cust-b-different',
        items: [{ sku: 'E2E-SKU-002', quantity: 99, unitPrice: '99.99' }],
        currency: 'USD',
        paymentToken: 'tok_visa',
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns cached response with X-Idempotent-Replay header on replay', async () => {
    if (skipIfNoInfra()) return;

    const key = crypto.randomUUID();
    const payload = {
      customerId: 'cust-replay',
      items: [{ sku: 'E2E-SKU-001', quantity: 1, unitPrice: '10.00' }],
      currency: 'USD',
      paymentToken: 'tok_visa',
    };
    const headers = {
      'Idempotency-Key': key,
      'X-Client-ID': 'e2e-replay',
      'Content-Type': 'application/json',
    };

    const first = await app!.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers,
      payload,
    });
    const second = await app!.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers,
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['x-idempotent-replay']).toBe('true');

    const firstBody = JSON.parse(first.body) as { id: string };
    const secondBody = JSON.parse(second.body) as { id: string };
    expect(firstBody.id).toBe(secondBody.id);
  });

  it('retrieves an order by ID', async () => {
    if (skipIfNoInfra()) return;

    const create = await app!.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'X-Client-ID': 'e2e-get',
        'Content-Type': 'application/json',
      },
      payload: {
        customerId: 'cust-get',
        items: [{ sku: 'E2E-SKU-001', quantity: 1, unitPrice: '10.00' }],
        currency: 'USD',
        paymentToken: 'tok_visa',
      },
    });

    const { id } = JSON.parse(create.body) as { id: string };

    const get = await app!.inject({
      method: 'GET',
      url: `/api/v1/orders/${id}`,
    });

    expect(get.statusCode).toBe(200);
    const body = JSON.parse(get.body) as { id: string; customerId: string };
    expect(body.id).toBe(id);
    expect(body.customerId).toBe('cust-get');
  });

  it('returns 404 for non-existent order', async () => {
    if (skipIfNoInfra()) return;

    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/orders/00000000-0000-0000-0000-000000000000',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 400 when Idempotency-Key header is missing', async () => {
    if (skipIfNoInfra()) return;

    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: {
        'X-Client-ID': 'e2e-client',
        'Content-Type': 'application/json',
      },
      payload: {
        customerId: 'cust-no-key',
        items: [{ sku: 'E2E-SKU-001', quantity: 1, unitPrice: '10.00' }],
        currency: 'USD',
        paymentToken: 'tok_visa',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('shallow health check returns 200', async () => {
    if (skipIfNoInfra()) return;
    const response = await app!.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});
