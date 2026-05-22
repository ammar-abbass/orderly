import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { registerHealthRoutes } from './routes/health.js';
import { registerOrderRoutes } from './routes/v1/orders.js';
import { registerDlqRoutes } from './routes/admin/dlq.js';
import { registerSagaAdminRoutes } from './routes/admin/sagas.js';
import { requestContextMiddleware } from './middleware/request-context.js';
import { errorHandler } from './middleware/error-handler.js';
import { IdempotencyStore } from '../infrastructure/redis/idempotency-store.js';
import type { OrderService } from '../domain/services/order-service.js';
import type { SagaOrchestrator } from '../domain/services/saga-orchestrator.js';
import type { SagaRepository } from '../domain/repositories/saga-repository.js';
import type { RateLimiter } from '../infrastructure/redis/rate-limiter.js';
import { getConfig } from '../config.js';
import { logger } from '../infrastructure/observability/logger.js';

export interface ServerDeps {
  orderService: OrderService;
  sagaOrchestrator: SagaOrchestrator;
  sagaRepo: SagaRepository;
  rateLimiter: RateLimiter;
}

/**
 * Build the public API Fastify instance.
 *
 * All service dependencies are injected — no infrastructure created here.
 *
 * Swagger is registered before routes so that `description` and `tags`
 * in route schema objects are valid (they are augmented by @fastify/swagger).
 *
 * Idempotency response caching is handled here via a server-level onSend
 * hook, because FastifyReply does not have .addHook() in Fastify 5.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const config = getConfig();
  const idempotencyStore = new IdempotencyStore();

  const app = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: true,
  });

  // ── Swagger (must register before routes) ────────────────────────────────
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Orderly API',
        description: 'Event-driven order service — public API',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${config.port}` }],
      tags: [
        { name: 'orders', description: 'Order management' },
        { name: 'health', description: 'Health checks' },
      ],
    },
  });

  config.nodeEnv !== 'production' &&
    (await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: false },
      staticCSP: true,
      // Only expose Swagger UI in non-production environments
      // ...(config.nodeEnv === 'production'
      //   ? { transformStaticCSP: () => ({ enabled: false }) }
      //   : {}),
    }));

  // ── Hooks ────────────────────────────────────────────────────────────────
  app.addHook('preHandler', requestContextMiddleware);

  // Request logging
  app.addHook('onRequest', (request, _reply, done) => {
    logger.info(
      { method: request.method, url: request.url, requestId: request.id },
      '→ incoming request',
    );
    done();
  });

  // Response logging + idempotency caching (server-level onSend)
  app.addHook('onSend', async (request, reply, payload) => {
    logger.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        requestId: request.id,
      },
      '← response sent',
    );

    // Cache successful responses for idempotency replay
    const meta = (
      request as typeof request & {
        idempotencyMeta?: { clientId: string; key: string; hash: string };
      }
    ).idempotencyMeta;
    if (meta && reply.statusCode >= 200 && reply.statusCode < 300) {
      await idempotencyStore
        .set(meta.clientId, meta.key, {
          requestId: request.id,
          status: reply.statusCode,
          response:
            typeof payload === 'string' ? payload : JSON.stringify(payload),
          requestHash: meta.hash,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) =>
          logger.error({ err }, 'Failed to cache idempotent response'),
        );
    }

    return payload;
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Routes
  // Health routes at root level (no prefix) — matches K8s probe paths:
  //   GET /health       → liveness probe
  //   GET /health/deep  → deep diagnostics
  //   GET /health/ready → readiness probe (same as deep, aliased for K8s)
  await app.register(async (healthRouter) => {
    await registerHealthRoutes(healthRouter);
  });

  await app.register(
    async (v1) => {
      await v1.register(
        async (ordersRouter) => {
          await registerOrderRoutes(ordersRouter, {
            orderService: deps.orderService,
            sagaRepo: deps.sagaRepo,
            rateLimiter: deps.rateLimiter,
          });
        },
        { prefix: '/orders' },
      );
    },
    { prefix: '/api/v1' },
  );

  logger.info({ port: config.port }, 'Public API server built');
  return app;
}

/**
 * Build the admin API Fastify instance on a separate port.
 * Deep health check is implemented inline — no cross-port redirects.
 */
export async function buildAdminServer(
  deps: ServerDeps,
): Promise<FastifyInstance> {
  const config = getConfig();

  const adminApp = Fastify({ logger: false, disableRequestLogging: true });

  await adminApp.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Orderly Admin API',
        description: 'Internal admin operations',
        version: '1.0.0',
      },
    },
  });

  config.nodeEnv !== 'production' &&
    (await adminApp.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: false },
      staticCSP: true,
    }));

  adminApp.setErrorHandler(errorHandler);

  await adminApp.register(
    async (admin) => {
      await registerDlqRoutes(admin);

      await admin.register(
        async (sagasRouter) => {
          await registerSagaAdminRoutes(sagasRouter, {
            sagaRepo: deps.sagaRepo,
            sagaOrchestrator: deps.sagaOrchestrator,
          });
        },
        { prefix: '/sagas' },
      );
    },
    { prefix: '/admin/v1' },
  );

  logger.info({ port: config.adminPort }, 'Admin API server built');
  return adminApp;
}
