import { Money } from '../value-objects/money.js';
import type { OrderItem } from './order-item.js';

export type OrderStatus =
  | 'PENDING'
  | 'PAID'
  | 'FULFILLED'
  | 'SHIPPED'
  | 'CANCELLED'
  | 'COMPENSATING';

/**
 * Order aggregate root.
 * All fields are readonly — state transitions return new objects via pure functions.
 */
export interface Order {
  readonly id: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly totalAmount: Money;
  readonly currency: string;
  readonly idempotencyKey: string | null;
  readonly items: readonly OrderItem[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Valid state transitions */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED', 'COMPENSATING'],
  PAID: ['FULFILLED', 'COMPENSATING'],
  FULFILLED: ['SHIPPED', 'COMPENSATING'],
  SHIPPED: [],
  CANCELLED: [],
  COMPENSATING: ['CANCELLED'],
} as const;

export function createOrder(
  id: string,
  customerId: string,
  items: readonly OrderItem[],
  currency: string,
  idempotencyKey?: string,
): Order {
  if (!items.length) throw new Error('Order must have at least one item');

  const total = items.reduce(
    (sum, item) => sum.add(item.unitPrice.multiply(item.quantity)),
    Money.zero(currency),
  );

  return {
    id,
    customerId,
    status: 'PENDING',
    totalAmount: total,
    currency: currency.toUpperCase(),
    idempotencyKey: idempotencyKey ?? null,
    items,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function canTransitionTo(order: Order, newStatus: OrderStatus): boolean {
  return (TRANSITIONS[order.status] as readonly OrderStatus[]).includes(newStatus);
}

export function transitionOrder(order: Order, newStatus: OrderStatus): Order {
  if (!canTransitionTo(order, newStatus)) {
    throw new Error(
      `Invalid state transition: ${order.status} → ${newStatus} for order ${order.id}`,
    );
  }
  return { ...order, status: newStatus, updatedAt: new Date() };
}
