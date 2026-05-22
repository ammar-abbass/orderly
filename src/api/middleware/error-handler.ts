import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../../infrastructure/observability/logger.js';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  [key: string]: unknown;
}

const BASE_URI = 'https://orderly.example.com/errors';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  logger.error(
    {
      err: error,
      requestId: request.id,
      path: request.url,
      method: request.method,
    },
    'Request error',
  );

  if (error instanceof ZodError) {
    const problems = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    const problem: ProblemDetails = {
      type: `${BASE_URI}/validation-error`,
      title: 'Validation Error',
      status: 422,
      detail: 'The request body contains invalid data',
      instance: request.url,
      errors: problems,
    };

    reply.status(422).type('application/problem+json').send(problem);
    return;
  }

  if (error.statusCode === 429) {
    const problem: ProblemDetails = {
      type: `${BASE_URI}/rate-limit`,
      title: 'Rate Limit Exceeded',
      status: 429,
      detail: error.message || 'Too many requests',
      instance: request.url,
    };
    reply.status(429).type('application/problem+json').send(problem);
    return;
  }

  const statusCode = error.statusCode ?? 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  const problem: ProblemDetails = {
    type: `${BASE_URI}/${isClientError ? 'client-error' : 'internal-error'}`,
    title:
      statusCode === 500
        ? 'Internal Server Error'
        : (error.name ?? 'Request Error'),
    status: statusCode,
    detail: error.message || 'An unexpected error occurred',
    instance: request.url,
  };

  reply.status(statusCode).type('application/problem+json').send(problem);
}
