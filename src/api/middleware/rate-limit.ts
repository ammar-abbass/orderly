import type { FastifyRequest, FastifyReply } from 'fastify';
import type { RateLimiter } from '../../infrastructure/redis/rate-limiter.js';
import { logger } from '../../infrastructure/observability/logger.js';

export function createRateLimitMiddleware(rateLimiter: RateLimiter) {
  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const clientId =
      (request.headers['x-client-id'] as string | undefined) ??
      request.ip ??
      'anonymous';

    const result = await rateLimiter.isAllowed(clientId);

    reply.header('X-RateLimit-Limit', '100');
    reply.header('X-RateLimit-Remaining', String(result.remaining));
    reply.header('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

    if (!result.allowed) {
      logger.warn({ clientId, path: request.url }, 'Rate limit exceeded');
      return reply
        .status(429)
        .header(
          'Retry-After',
          String(Math.ceil((result.resetTime - Date.now()) / 1000)),
        )
        .type('application/problem+json')
        .send({
          type: 'https://orderly.example.com/errors/rate-limit',
          title: 'Rate Limit Exceeded',
          status: 429,
          detail: 'Too many requests. Please retry after the indicated time.',
        });
    }
  };
}
