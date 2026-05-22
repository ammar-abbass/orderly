import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { getSql } from '../../infrastructure/database/connection.js';
import { getRedis } from '../../infrastructure/redis/connection.js';
import { getQueueConnection } from '../../infrastructure/queue/connection.js';
import { getConfig } from '../../config.js';
import { logger } from '../../infrastructure/observability/logger.js';

const MANAGED_QUEUES = [
  'payment-processing',
  'inventory-release',
  'webhook-delivery',
] as const;
const QUEUE_WARN_DEPTH = 5_000;
const QUEUE_CRITICAL_DEPTH = 10_000;

/**
 * Register health routes.
 *
 * GET /health       — shallow, for load-balancer liveness probes (always 200)
 * GET /health/deep  — deep: PostgreSQL, Redis, queue depth, memory
 *                     Returns 503 if PostgreSQL unreachable (critical dependency)
 *                     Returns 200 with warnings for Redis or queue depth issues
 *
 * SPEC §12.4 compliance:
 *   - Queue depth > 5,000 → warn (still 200)
 *   - Queue depth > 10,000 → critical (503 + Retry-After header)
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        description: 'Shallow health check for load balancers',
        tags: ['health'],
      },
    },
    async () => ({ status: 'ok', timestamp: new Date().toISOString() }),
  );

  /** Deep — checks PostgreSQL, Redis, and memory. */
  app.get(
    '/health/deep',
    {
      schema: {
        description:
          'Deep health check: PostgreSQL, Redis, queue depth, memory',
        tags: ['health'],
      },
    },
    async (_request, reply) => {
      const config = getConfig();
      const checks: Record<
        string,
        { status: string; latencyMs: number; detail?: string }
      > = {};
      let httpStatus = 200;

      // ── PostgreSQL ──────────────────────────────────────────────────────
      const t0 = Date.now();
      try {
        await getSql()`SELECT 1`;
        checks['postgres'] = { status: 'ok', latencyMs: Date.now() - t0 };
      } catch (err) {
        httpStatus = 503;
        checks['postgres'] = {
          status: 'error',
          latencyMs: Date.now() - t0,
          detail: err instanceof Error ? err.message : 'connection failed',
        };
        logger.error({ err }, 'Deep health: PostgreSQL check failed');
      }

      // ── Redis ───────────────────────────────────────────────────────────
      const t1 = Date.now();
      try {
        await getRedis().ping();
        checks['redis'] = { status: 'ok', latencyMs: Date.now() - t1 };
      } catch (err) {
        // Redis down is degraded, not fatal — see SPEC §13.4
        checks['redis'] = {
          status: 'degraded',
          latencyMs: Date.now() - t1,
          detail: err instanceof Error ? err.message : 'ping failed',
        };
      }

      // ── Queue depth ─────────────────────────────────────────────────────
      let totalDepth = 0;
      try {
        for (const queueName of MANAGED_QUEUES) {
          const queue = new Queue(queueName, {
            connection: getQueueConnection(),
            prefix: config.queuePrefix,
          });
          const waiting = await queue.getWaitingCount();
          const delayed = await queue.getDelayedCount();
          totalDepth += waiting + delayed;
          await queue.close();
        }

        let queueStatus = 'ok';
        if (totalDepth > QUEUE_CRITICAL_DEPTH) {
          queueStatus = 'critical';
          httpStatus = 503;
          reply.header('Retry-After', '30');
        } else if (totalDepth > QUEUE_WARN_DEPTH) {
          queueStatus = 'warning';
        }

        checks['queue'] = {
          status: queueStatus,
          latencyMs: 0,
          detail: `Total pending jobs: ${totalDepth} (warn>${QUEUE_WARN_DEPTH}, critical>${QUEUE_CRITICAL_DEPTH})`,
        };
      } catch (err) {
        checks['queue'] = {
          status: 'unknown',
          latencyMs: 0,
          detail: err instanceof Error ? err.message : 'queue check failed',
        };
      }

      // ── Memory ──────────────────────────────────────────────────────────
      const heap = process.memoryUsage();
      const heapUsedMb = Math.round(heap.heapUsed / 1024 / 1024);
      const heapTotalMb = Math.round(heap.heapTotal / 1024 / 1024);
      const heapRatio = heapUsedMb / (heapTotalMb || 1);
      checks['memory'] = {
        status: heapRatio > 0.9 ? 'warning' : 'ok',
        latencyMs: 0,
        detail: `${heapUsedMb}MB / ${heapTotalMb}MB (${Math.round(heapRatio * 100)}%)`,
      };

      const overallStatus = httpStatus >= 500 ? 'error' : 'ok';
      return reply.status(httpStatus).send({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks,
      });
    },
  );

  // Alias for K8s readiness probes — same handler as /health/deep
  app.get(
    '/health/ready',
    {
      schema: {
        description: 'Readiness probe (alias for /health/deep)',
        tags: ['health'],
      },
    },
    async (_request, reply) => {
      // Delegate to /health/deep via inject to avoid duplicating the handler
      const deepResult = await app.inject({ method: 'GET', url: '/health/deep' });
      return reply
        .status(deepResult.statusCode)
        .headers(deepResult.headers)
        .send(deepResult.body);
    },
  );
}
