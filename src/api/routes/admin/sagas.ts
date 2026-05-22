import type { FastifyInstance } from 'fastify';
import type { ISagaRepository } from '../../../domain/repositories/interfaces.js';
import type { SagaOrchestrator } from '../../../domain/services/saga-orchestrator.js';
import { logger } from '../../../infrastructure/observability/logger.js';
import { verifyAdminKey } from '../../middleware/admin-auth.js';

export interface SagaRouteDeps {
  sagaRepo: ISagaRepository;
  sagaOrchestrator: SagaOrchestrator;
}

export async function registerSagaAdminRoutes(
  app: FastifyInstance,
  deps: SagaRouteDeps,
): Promise<void> {
  const { sagaRepo, sagaOrchestrator } = deps;

  // GET /admin/v1/sagas — list running/stuck sagas older than threshold
  app.get(
    '/',
    {
      schema: {
        description: 'List running or stuck sagas older than threshold',
        tags: ['admin'],
      },
    },
    async (request, reply) => {
      if (!verifyAdminKey(request, reply)) return;

      const qs = request.query as { olderThanMinutes?: string };
      const olderThan = parseInt(qs.olderThanMinutes ?? '10', 10);
      const sagas = await sagaRepo.findRunningSagas(olderThan);

      return reply.send({
        total: sagas.length,
        sagas: sagas.map((s) => ({
          id: s.id,
          orderId: s.orderId,
          status: s.status,
          currentStep: s.currentStep,
          startedAt: s.startedAt.toISOString(),
          completedAt: s.completedAt?.toISOString() ?? null,
          stuckForMs: Date.now() - s.startedAt.getTime(),
        })),
      });
    },
  );

  // GET /admin/v1/sagas/:id — get saga with full step history
  app.get(
    '/:id',
    {
      schema: {
        description: 'Get saga detail with full step history',
        tags: ['admin'],
      },
    },
    async (request, reply) => {
      if (!verifyAdminKey(request, reply)) return;

      const { id } = request.params as { id: string };
      const saga = await sagaRepo.findById(id);

      if (!saga) {
        return reply
          .status(404)
          .type('application/problem+json')
          .send({
            type: 'https://orderly.example.com/errors/not-found',
            title: 'Not Found',
            status: 404,
            detail: `Saga ${id} not found`,
            instance: request.url,
          });
      }

      const steps = await sagaRepo.getSteps(saga.id);

      return reply.send({
        id: saga.id,
        orderId: saga.orderId,
        type: saga.type,
        status: saga.status,
        currentStep: saga.currentStep,
        startedAt: saga.startedAt.toISOString(),
        completedAt: saga.completedAt?.toISOString() ?? null,
        metadata: saga.metadata,
        steps: steps.map((s) => ({
          id: s.id,
          stepName: s.stepName,
          stepOrder: s.stepOrder,
          status: s.status,
          inputPayload: s.inputPayload,
          outputPayload: s.outputPayload,
          errorMessage: s.errorMessage,
          startedAt: s.startedAt?.toISOString() ?? null,
          completedAt: s.completedAt?.toISOString() ?? null,
          compensationStatus: s.compensationStatus,
          compensationError: s.compensationError,
        })),
      });
    },
  );

  // POST /admin/v1/sagas/:id/compensate — trigger manual compensation for a stuck saga
  app.post(
    '/:id/compensate',
    {
      schema: {
        description: 'Trigger manual compensation for a stuck saga',
        tags: ['admin'],
      },
    },
    async (request, reply) => {
      if (!verifyAdminKey(request, reply)) return;

      const { id } = request.params as { id: string };
      const saga = await sagaRepo.findById(id);

      if (!saga) {
        return reply
          .status(404)
          .type('application/problem+json')
          .send({
            type: 'https://orderly.example.com/errors/not-found',
            title: 'Not Found',
            status: 404,
            detail: `Saga ${id} not found`,
            instance: request.url,
          });
      }

      if (saga.status !== 'RUNNING') {
        return reply
          .status(409)
          .type('application/problem+json')
          .send({
            type: 'https://orderly.example.com/errors/invalid-state',
            title: 'Invalid State',
            status: 409,
            detail: `Cannot compensate saga in status ${saga.status}. Only RUNNING sagas can be manually compensated.`,
            instance: request.url,
          });
      }

      logger.warn(
        { sagaId: saga.id, orderId: saga.orderId },
        'Manual compensation triggered via admin API',
      );

      // Reconstruct context from persisted metadata
      const meta = saga.metadata as Record<string, unknown>;
      void sagaOrchestrator
        .compensate(
          saga.id,
          {
            orderId: saga.orderId,
            customerId: (meta['customerId'] as string | undefined) ?? '',
            items:
              (meta['items'] as
                | Array<{ sku: string; quantity: number }>
                | undefined) ?? [],
            totalAmount: (meta['totalAmount'] as
              | { amount: string; currency: string }
              | undefined) ?? {
              amount: '0.00',
              currency: 'USD',
            },
            paymentToken: (meta['paymentToken'] as string | undefined) ?? '',
          },
          saga,
        )
        .catch((err: unknown) =>
          logger.error({ err, sagaId: saga.id }, 'Manual compensation failed'),
        );

      return reply.send({
        message: `Compensation triggered for saga ${saga.id}`,
        orderId: saga.orderId,
      });
    },
  );
}
