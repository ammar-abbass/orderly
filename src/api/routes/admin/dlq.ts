import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { getQueueConnection } from '../../../infrastructure/queue/connection.js';
import { getConfig } from '../../../config.js';
import { logger } from '../../../infrastructure/observability/logger.js';
import { verifyAdminKey } from '../../middleware/admin-auth.js';

const MANAGED_QUEUES = [
  'payment-processing',
  'inventory-release',
  'webhook-delivery',
] as const;


export async function registerDlqRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/v1/dlq — list failed jobs across all queues
  app.get(
    '/',
    {
      schema: {
        description: 'List failed jobs across all queues',
        tags: ['admin'],
      },
    },
    async (request, reply) => {
      if (!verifyAdminKey(request, reply)) return;

      const config = getConfig();
      const qs = request.query as { limit?: string; queue?: string };
      const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);
      const targetQueues = qs.queue ? [qs.queue] : [...MANAGED_QUEUES];

      const jobs: unknown[] = [];

      for (const queueName of targetQueues) {
        const queue = new Queue(queueName, {
          connection: getQueueConnection(),
          prefix: config.queuePrefix,
        });
        const failed = await queue.getFailed(0, limit - 1);
        for (const job of failed) {
          jobs.push({
            jobId: job.id,
            queue: queueName,
            name: job.name,
            data: job.data,
            failedReason: job.failedReason,
            attemptsMade: job.attemptsMade,
            timestamp: new Date(job.timestamp).toISOString(),
            processedOn: job.processedOn
              ? new Date(job.processedOn).toISOString()
              : null,
            finishedOn: job.finishedOn
              ? new Date(job.finishedOn).toISOString()
              : null,
          });
        }
        await queue.close();
      }

      return reply.send({ total: jobs.length, jobs });
    },
  );

  // POST /admin/v1/dlq/retry/:jobId — retry a specific failed job
  app.post(
    '/retry/:jobId',
    { schema: { description: 'Re-queue a failed DLQ job', tags: ['admin'] } },
    async (request, reply) => {
      if (!verifyAdminKey(request, reply)) return;

      const config = getConfig();
      const { jobId } = request.params as { jobId: string };
      const qs = request.query as { queue?: string };
      const targetQueues = qs.queue ? [qs.queue] : [...MANAGED_QUEUES];

      for (const queueName of targetQueues) {
        const queue = new Queue(queueName, {
          connection: getQueueConnection(),
          prefix: config.queuePrefix,
        });
        const job = await queue.getJob(jobId);
        if (job) {
          await job.retry('failed');
          await queue.close();
          logger.info({ jobId, queueName }, 'DLQ job re-queued by admin');
          return reply.send({
            message: `Job ${jobId} re-queued in ${queueName}`,
          });
        }
        await queue.close();
      }

      return reply
        .status(404)
        .type('application/problem+json')
        .send({
          type: 'https://orderly.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `Job ${jobId} not found in any managed queue`,
          instance: request.url,
        });
    },
  );

  // DELETE /admin/v1/dlq/:jobId — remove a failed job permanently
  app.delete(
    '/:jobId',
    {
      schema: {
        description: 'Remove a failed DLQ job permanently',
        tags: ['admin'],
      },
    },
    async (request, reply) => {
      if (!verifyAdminKey(request, reply)) return;

      const config = getConfig();
      const { jobId } = request.params as { jobId: string };
      const qs = request.query as { queue?: string };
      const targetQueues = qs.queue ? [qs.queue] : [...MANAGED_QUEUES];

      for (const queueName of targetQueues) {
        const queue = new Queue(queueName, {
          connection: getQueueConnection(),
          prefix: config.queuePrefix,
        });
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          await queue.close();
          logger.info({ jobId, queueName }, 'DLQ job removed by admin');
          return reply.send({
            message: `Job ${jobId} removed from ${queueName}`,
          });
        }
        await queue.close();
      }

      return reply
        .status(404)
        .type('application/problem+json')
        .send({
          type: 'https://orderly.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `Job ${jobId} not found in any managed queue`,
          instance: request.url,
        });
    },
  );
}
