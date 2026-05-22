import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { getConfig } from '../../config.js';

/**
 * Verify admin API key using constant-time comparison to prevent timing attacks.
 * Returns true if valid, sends 401/403 and returns false otherwise.
 */
export function verifyAdminKey(request: FastifyRequest, reply: FastifyReply): boolean {
  const config = getConfig();
  const provided = request.headers['x-api-key'] as string | undefined;

  if (!provided) {
    void reply.status(401).type('application/problem+json').send({
      type: 'https://orderly.example.com/errors/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'X-API-Key header is required for admin endpoints.',
    });
    return false;
  }

  // Timing-safe comparison to prevent timing attacks
  let valid = false;
  try {
    const expected = Buffer.from(config.adminApiKey, 'utf8');
    const actual = Buffer.from(provided, 'utf8');
    // timingSafeEqual requires equal-length buffers
    valid =
      expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    valid = false;
  }

  if (!valid) {
    void reply.status(403).type('application/problem+json').send({
      type: 'https://orderly.example.com/errors/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'Invalid admin API key.',
    });
    return false;
  }

  return true;
}
