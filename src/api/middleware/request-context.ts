import type { FastifyRequest, FastifyReply } from 'fastify';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  readonly traceId: string;
  readonly requestId: string;
  readonly startTime: number;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function requestContextMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const traceId =
    (request.headers['x-trace-id'] as string | undefined) ??
    crypto.randomUUID();

  const context: RequestContext = {
    traceId,
    requestId: request.id,
    startTime: Date.now(),
  };

  reply.header('x-trace-id', traceId);
  asyncLocalStorage.run(context, done);
}

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}
