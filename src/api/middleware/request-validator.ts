import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      request.body = schema.parse(request.body) as unknown as typeof request.body;
    } catch (error) {
      if (error instanceof ZodError) {
        reply.status(422).type('application/problem+json').send({
          type: 'https://orderly.example.com/errors/validation-error',
          title: 'Validation Error',
          status: 422,
          detail: 'The request body contains invalid data.',
          errors: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        });
        return;
      }
      throw error;
    }
  };
}
