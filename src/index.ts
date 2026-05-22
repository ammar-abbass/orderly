/**
 * Orderly — Composition Root
 *
 * This is the only file that knows about concrete implementations.
 * Everything else depends on interfaces or receives injected instances.
 *
 * Startup sequence:
 *   1. Load & validate configuration
 *   2. Run database migrations
 *   3. Construct all singletons (repositories, services, circuit breaker)
 *   4. Start BullMQ workers with injected singletons
 *   5. Start outbox processor
 *   6. Start public API + admin API
 *
 * Shutdown sequence (SIGTERM / SIGINT):
 *   1. Stop accepting new HTTP connections
 *   2. Drain BullMQ workers (max 30s)
 *   3. Stop outbox processor
 *   4. Close DB and Redis connections
 *   5. Flush OpenTelemetry spans
 *   6. Exit 0
 */

import { getConfig } from './config.js';
import { runMigrations } from './infrastructure/database/migration-runner.js';
import { closeDatabase } from './infrastructure/database/connection.js';
import { closeRedis } from './infrastructure/redis/connection.js';
import { closeQueueConnection } from './infrastructure/queue/connection.js';
import { initTracer, shutdownTracer } from './infrastructure/observability/tracer.js';
import { logger } from './infrastructure/observability/logger.js';
import { metrics } from './infrastructure/observability/metrics.js';

// Repositories
import { OrderRepository } from './domain/repositories/order-repository.js';
import { SagaRepository } from './domain/repositories/saga-repository.js';
import { InventoryRepository } from './domain/repositories/inventory-repository.js';
import { OutboxRepository } from './domain/repositories/outbox-repository.js';

// Infrastructure
import { PostgresAdvisoryLock } from './infrastructure/locking/postgres-advisory-lock.js';
import { StripeAdapter } from './infrastructure/payment/stripe-adapter.js';
import { createPaymentResiliencePolicy } from './infrastructure/payment/circuit-breaker.js';
import { PostgresTransactionManager } from './infrastructure/database/transaction-manager.js';
import { BullMQSagaEnqueuer } from './infrastructure/queue/saga-enqueuer.js';
import { RateLimiter } from './infrastructure/redis/rate-limiter.js';

// Domain services
import { InventoryService } from './domain/services/inventory-service.js';
import { PaymentService } from './domain/services/payment-service.js';
import { SagaOrchestrator } from './domain/services/saga-orchestrator.js';
import { OrderService } from './domain/services/order-service.js';

// Workers & processors
import { startWorkers, stopWorkers } from './infrastructure/queue/workers/index.js';
import { OutboxProcessor } from './events/outbox/outbox-processor.js';
import { WebhookDispatcher } from './events/webhooks/webhook-dispatcher.js';

// API
import { buildServer, buildAdminServer } from './api/server.js';

async function main(): Promise<void> {
  const config = getConfig();
  logger.info({ nodeEnv: config.nodeEnv, port: config.port }, 'Starting Orderly');

  // ── Observability ──────────────────────────────────────────────────────
  initTracer();

  // ── Migrations ─────────────────────────────────────────────────────────
  await runMigrations();

  // ── Repositories (singletons) ──────────────────────────────────────────
  const orderRepo      = new OrderRepository();
  const sagaRepo       = new SagaRepository();
  const inventoryRepo  = new InventoryRepository();
  const outboxRepo     = new OutboxRepository();

  // ── Infrastructure singletons ──────────────────────────────────────────
  const lockManager    = new PostgresAdvisoryLock();
  const gateway        = new StripeAdapter();
  const txManager      = new PostgresTransactionManager();
  const sagaEnqueuer   = new BullMQSagaEnqueuer();
  // Circuit breaker is long-lived — MUST be a singleton so failure counts accumulate
  const resilience     = createPaymentResiliencePolicy();

  // ── Domain services (singletons, fully injected) ───────────────────────
  const inventoryService  = new InventoryService(inventoryRepo, lockManager, logger, metrics);
  const paymentService    = new PaymentService(gateway, resilience, logger, metrics);
  const webhookDispatcher = new WebhookDispatcher();

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

  const orderService = new OrderService(
    orderRepo,
    outboxRepo,
    sagaEnqueuer,
    txManager,
    logger,
    metrics,
  );

  // ── BullMQ Workers (receive injected singletons) ───────────────────────
  startWorkers({ paymentService, inventoryService, sagaOrchestrator, webhookDispatcher });

  // ── Outbox Processor ───────────────────────────────────────────────────
  const outboxProcessor = new OutboxProcessor(outboxRepo);
  void outboxProcessor.start();

  // ── API Servers ────────────────────────────────────────────────────────
  const rateLimiter = new RateLimiter();
  const serverDeps = { orderService, sagaOrchestrator, sagaRepo, rateLimiter };

  const app       = await buildServer(serverDeps);
  const adminApp  = await buildAdminServer(serverDeps);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  await adminApp.listen({ port: config.adminPort, host: '0.0.0.0' });

  logger.info(
    { publicPort: config.port, adminPort: config.adminPort },
    '🚀 Orderly is ready',
  );

  // ── Graceful shutdown ──────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received — draining');

    // 1. Stop accepting new HTTP connections
    await Promise.allSettled([app.close(), adminApp.close()]);

    // 2. Stop outbox processor
    await outboxProcessor.stop();

    // 3. Drain workers (30s timeout)
    const drainTimeout = setTimeout(() => {
      logger.warn({}, 'Worker drain timed out — forcing exit');
      process.exit(1);
    }, 30_000);

    await stopWorkers();
    clearTimeout(drainTimeout);

    // 4. Close connections
    await Promise.allSettled([closeDatabase(), closeRedis(), closeQueueConnection()]);

    // 5. Flush telemetry
    await shutdownTracer();

    logger.info({}, 'Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
