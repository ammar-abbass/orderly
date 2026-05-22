import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { IdempotencyStore } from '../../infrastructure/redis/idempotency-store.js';
import { logger } from '../../infrastructure/observability/logger.js';

const store = new IdempotencyStore();

/**
 * Idempotency preHandler.
 *
 * Requires `Idempotency-Key` (UUID) and `X-Client-ID` headers on all
 * mutation endpoints.
 *
 * Hit  → return cached response with X-Idempotent-Replay: true header
 * Miss → continue; Fastify route-level onSend hook caches the response
 * Collision (same key, different body hash) → 409 Conflict
 *
 * Fastify 5 note: `reply.addHook` does not exist on FastifyReply.
 * Response caching is handled by registering an instance-level onSend hook
 * keyed off a per-request flag stored on request.context.
 */
export async function idempotencyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const idempotencyKey = request.headers['idempotency-key'] as
    | string
    | undefined;
  const clientId = request.headers['x-client-id'] as string | undefined;

  if (!idempotencyKey || !clientId) {
    return reply.status(400).type('application/problem+json').send({
      type: 'https://orderly.example.com/errors/missing-headers',
      title: 'Missing Required Headers',
      status: 400,
      detail:
        'Both Idempotency-Key and X-Client-ID headers are required for mutation endpoints.',
    });
  }

  const requestHash = hashBody(request);
  const existing = await store.get(clientId, idempotencyKey);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return reply.status(409).type('application/problem+json').send({
        type: 'https://orderly.example.com/errors/idempotency-mismatch',
        title: 'Idempotency Key Conflict',
        status: 409,
        detail:
          'The Idempotency-Key was already used with a different request body. Use a new key for a different request.',
      });
    }

    logger.info(
      { clientId, idempotencyKey },
      'Returning cached idempotent response',
    );
    return reply
      .status(existing.status)
      .header('X-Idempotent-Replay', 'true')
      .send(JSON.parse(existing.response) as unknown);
  }

  // Tag the request so the server-level onSend hook knows to cache this response
  (
    request as FastifyRequest & {
      idempotencyMeta?: { clientId: string; key: string; hash: string };
    }
  ).idempotencyMeta = {
    clientId,
    key: idempotencyKey,
    hash: requestHash,
  };
}

export function hashBody(request: FastifyRequest): string {
  return createHash('sha256')
    .update(JSON.stringify(request.body ?? {}))
    .digest('hex');
}
