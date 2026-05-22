import { v4 as uuidv4 } from 'uuid';
import { createOrder, type Order } from '../entities/order.js';
import { createOrderItem } from '../entities/order-item.js';
import type { IOrderRepository, IOutboxRepository } from '../repositories/interfaces.js';
import type { ITransactionManager } from '../ports/transaction-manager.js';
import type { ILogger } from '../ports/logger.js';
import type { IMetrics } from '../ports/metrics.js';

export interface CreateOrderRequest {
  readonly customerId: string;
  readonly items: ReadonlyArray<{
    sku: string;
    quantity: number;
    unitPrice: string;
  }>;
  readonly currency: string;
  readonly idempotencyKey?: string;
  readonly paymentToken: string;
}

export interface CreateOrderResult {
  readonly order: Order;
  readonly sagaId: string;
}

/**
 * ISagaEnqueuer — port for triggering saga execution.
 *
 * The composition root provides a BullMQ-backed implementation that
 * enqueues the saga job for reliable, crash-recoverable processing.
 */
export interface ISagaEnqueuer {
  enqueue(context: {
    orderId: string;
    customerId: string;
    items: ReadonlyArray<{ sku: string; quantity: number }>;
    totalAmount: { amount: string; currency: string };
    paymentToken: string;
  }): Promise<string>;
}

/**
 * OrderService — coordinates order creation.
 *
 * Critical correctness guarantee:
 *   The order row, all order_items rows, and the order.created outbox event
 *   are written in a SINGLE PostgreSQL transaction. If the process crashes
 *   after the transaction commits, the outbox processor will replay the event.
 *   There is no window where the order exists without its outbox event.
 *
 * The saga is enqueued via BullMQ for reliable async processing.
 * If the enqueue fails, the saga recovery mechanism will detect stale orders.
 *
 * All dependencies injected via constructor — no infrastructure imports.
 */
export class OrderService {
  constructor(
    private readonly orderRepo: IOrderRepository,
    private readonly outboxRepo: IOutboxRepository,
    private readonly sagaEnqueuer: ISagaEnqueuer,
    private readonly txManager: ITransactionManager,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
  ) {}

  async createOrder(request: CreateOrderRequest): Promise<CreateOrderResult> {
    const orderId = uuidv4();

    this.logger.info({ orderId, customerId: request.customerId }, 'Creating order');

    const items = request.items.map((item) =>
      createOrderItem(uuidv4(), orderId, item.sku, item.quantity, item.unitPrice, request.currency),
    );

    const order = createOrder(orderId, request.customerId, items, request.currency, request.idempotencyKey);

    // ── Atomic write: order + outbox event in one transaction ──────────────
    await this.txManager.begin(async (tx) => {
      await this.orderRepo.createWithSql(order, tx);
      await this.outboxRepo.createWithSql(
        {
          aggregateType: 'order',
          aggregateId: orderId,
          eventType: 'order.created',
          payload: {
            orderId,
            customerId: request.customerId,
            totalAmount: order.totalAmount.toJSON(),
            itemCount: items.length,
            queue: 'webhook-delivery',
          },
          headers: {
            'x-idempotency-key': request.idempotencyKey ?? '',
          },
          status: 'PENDING',
          retryCount: 0,
        },
        tx,
      );
    });

    this.metrics.increment('orders.created', { currency: request.currency, status: 'pending' });
    this.logger.info({ orderId }, 'Order and outbox event written atomically');

    // ── Enqueue saga via BullMQ for reliable async processing ──────────────
    const sagaId = await this.sagaEnqueuer
      .enqueue({
        orderId,
        customerId: request.customerId,
        items: request.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        totalAmount: order.totalAmount.toJSON(),
        paymentToken: request.paymentToken,
      })
      .catch((err: unknown) => {
        // If enqueue fails, saga recovery will pick up stale orders
        this.logger.error({ err, orderId }, 'Failed to enqueue saga — will be recovered via saga recovery');
        return uuidv4(); // Return placeholder ID
      });

    return { order, sagaId };
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.orderRepo.findById(id);
  }
}
