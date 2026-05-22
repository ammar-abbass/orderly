import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CreateOrderSchema, OrderResponseSchema, SagaResponseSchema } from '../../schemas/order.schema.js';
import { idempotencyMiddleware } from '../../middleware/idempotency.js';
import { createRateLimitMiddleware } from '../../middleware/rate-limit.js';
import type { OrderService } from '../../../domain/services/order-service.js';
import type { SagaRepository } from '../../../domain/repositories/saga-repository.js';
import type { RateLimiter } from '../../../infrastructure/redis/rate-limiter.js';
import { logger } from '../../../infrastructure/observability/logger.js';
import { metrics } from '../../../infrastructure/observability/metrics.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { validateBody } from '../../middleware/request-validator.js';

export interface OrderRouteDeps {
  orderService: OrderService;
  sagaRepo: SagaRepository;
  rateLimiter: RateLimiter;
}

/**
 * Register order routes with injected dependencies.
 *
 * Fastify 5 typing note: when using JSON schema objects in `schema.body`,
 * we must NOT also provide a generic `FastifyRequest<{ Body: T }>` because
 * Fastify infers the body type from the schema. We cast `request.body`
 * instead to avoid the TS2345 generic argument mismatch.
 *
 * The `description` and `tags` fields in schema are valid after
 * @fastify/swagger is registered (it augments FastifySchema types).
 */
export async function registerOrderRoutes(
  app: FastifyInstance,
  deps: OrderRouteDeps,
): Promise<void> {
  const { orderService, sagaRepo, rateLimiter } = deps;
  const rateLimitMiddleware = createRateLimitMiddleware(rateLimiter);

  // ── POST /api/v1/orders ─────────────────────────────────────────────────
  app.post(
    '/',
    {
      preHandler: [
        rateLimitMiddleware,
        idempotencyMiddleware,
        validateBody(CreateOrderSchema),
      ],
      schema: {
        description:
          'Create a new order. Idempotent — supply a unique Idempotency-Key per request.',
        tags: ['orders'],
        body: zodToJsonSchema(CreateOrderSchema),
        response: {
          201: {
            description: 'Order accepted and processing started',
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              customerId: { type: 'string' },
              status: { type: 'string', enum: ['PENDING'] },
              totalAmount: {
                type: 'object',
                properties: {
                  amount: { type: 'string' },
                  currency: { type: 'string' },
                },
              },
              items: { type: 'array' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startTime = Date.now();

      // Parse & validate body explicitly with Zod for runtime safety
      const parsed = CreateOrderSchema.parse(request.body);

      const result = await orderService.createOrder({
        customerId: parsed.customerId,
        items: parsed.items,
        currency: parsed.currency,
        paymentToken: parsed.paymentToken,
        idempotencyKey: request.headers['idempotency-key'] as string,
      });

      metrics.recordHistogram(
        'orders.api.create.duration',
        Date.now() - startTime,
      );
      logger.info({ orderId: result.order.id }, 'Order accepted via API');

      return reply.status(201).send({
        id: result.order.id,
        customerId: result.order.customerId,
        status: result.order.status,
        totalAmount: result.order.totalAmount.toJSON(),
        items: result.order.items.map((item) => ({
          id: item.id,
          sku: item.sku.value,
          quantity: item.quantity,
          unitPrice: item.unitPrice.amount,
        })),
        createdAt: result.order.createdAt.toISOString(),
        updatedAt: result.order.updatedAt.toISOString(),
      });
    },
  );

  // GET /api/v1/orders/:id — retrieve order details
  app.get(
    '/:id',
    {
      schema: {
        description: 'Retrieve an order by its ID',
        tags: ['orders'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        response: {
          200: zodToJsonSchema(OrderResponseSchema),
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const order = await orderService.getOrder(id);

      if (!order) {
        return reply
          .status(404)
          .type('application/problem+json')
          .send({
            type: 'https://orderly.example.com/errors/not-found',
            title: 'Not Found',
            status: 404,
            detail: `Order ${id} not found`,
            instance: request.url,
          });
      }

      return reply.send({
        id: order.id,
        customerId: order.customerId,
        status: order.status,
        totalAmount: order.totalAmount.toJSON(),
        items: order.items.map((i) => ({
          id: i.id,
          sku: i.sku.value,
          quantity: i.quantity,
          unitPrice: i.unitPrice.amount,
        })),
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
      });
    },
  );

  // GET /api/v1/orders/:id/saga — retrieve saga execution history for an order (debug)
  app.get(
    '/:id/saga',
    {
      schema: {
        description: 'Retrieve the saga execution history for an order (debug)',
        tags: ['orders'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        response: {
          200: zodToJsonSchema(SagaResponseSchema),
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const saga = await sagaRepo.findByOrderId(id);

      if (!saga) {
        return reply
          .status(404)
          .type('application/problem+json')
          .send({
            type: 'https://orderly.example.com/errors/not-found',
            title: 'Not Found',
            status: 404,
            detail: `No saga found for order ${id}`,
            instance: request.url,
          });
      }

      const steps = await sagaRepo.getSteps(saga.id);

      return reply.send({
        id: saga.id,
        orderId: saga.orderId,
        status: saga.status,
        currentStep: saga.currentStep,
        startedAt: saga.startedAt.toISOString(),
        completedAt: saga.completedAt?.toISOString() ?? null,
        steps: steps.map((s) => ({
          id: s.id,
          stepName: s.stepName,
          stepOrder: s.stepOrder,
          status: s.status,
          errorMessage: s.errorMessage,
          startedAt: s.startedAt?.toISOString() ?? null,
          completedAt: s.completedAt?.toISOString() ?? null,
        })),
      });
    },
  );
}
