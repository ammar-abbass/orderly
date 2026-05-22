import { z } from 'zod';

export const CreateOrderItemSchema = z.object({
  sku: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[A-Za-z0-9\-_]+$/,
      'SKU must be alphanumeric with hyphens and underscores',
    ),
  quantity: z.number().int().positive().max(1000),
  unitPrice: z
    .string()
    .regex(/^\d+\.\d{2}$/, 'unitPrice must be in format "29.99"'),
});

export const CreateOrderSchema = z.object({
  customerId: z.string().min(1).max(64),
  items: z.array(CreateOrderItemSchema).min(1).max(50),
  currency: z.string().length(3).default('USD'),
  paymentToken: z.string().min(1).max(512),
});

export const OrderResponseSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string(),
  status: z.enum([
    'PENDING',
    'PAID',
    'FULFILLED',
    'SHIPPED',
    'CANCELLED',
    'COMPENSATING',
  ]),
  totalAmount: z.object({ amount: z.string(), currency: z.string() }),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      sku: z.string(),
      quantity: z.number(),
      unitPrice: z.string(),
    }),
  ),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const SagaResponseSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'COMPENSATING', 'FAILED']),
  currentStep: z.number(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  steps: z.array(
    z.object({
      id: z.string().uuid(),
      stepName: z.string(),
      stepOrder: z.number(),
      status: z.string(),
      errorMessage: z.string().nullable(),
      startedAt: z.string().datetime().nullable(),
      completedAt: z.string().datetime().nullable(),
    }),
  ),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type OrderResponse = z.infer<typeof OrderResponseSchema>;
