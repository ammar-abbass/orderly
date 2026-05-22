import type { Sql } from 'postgres';
import { getSql } from '../../infrastructure/database/connection.js';
import type { Order, OrderStatus } from '../entities/order.js';
import type { OrderItem } from '../entities/order-item.js';
import { Money } from '../value-objects/money.js';
import { SKU } from '../value-objects/sku.js';
import type { IOrderRepository } from './interfaces.js';

interface OrderRow {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total_amount: string;
  currency: string;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  sku: string;
  quantity: number;
  unit_price: string;
}

export class OrderRepository implements IOrderRepository {
  async findById(id: string): Promise<Order | null> {
    const sql = getSql();
    const [orderRow] = await sql<OrderRow[]>`SELECT * FROM orders WHERE id = ${id}`;
    if (!orderRow) return null;

    const itemRows = await sql<OrderItemRow[]>`
      SELECT * FROM order_items WHERE order_id = ${id} ORDER BY id
    `;
    return this.toDomain(orderRow, itemRows);
  }

  async findByIdempotencyKey(key: string): Promise<Order | null> {
    const sql = getSql();
    const [orderRow] = await sql<OrderRow[]>`
      SELECT * FROM orders WHERE idempotency_key = ${key}
    `;
    if (!orderRow) return null;

    const itemRows = await sql<OrderItemRow[]>`
      SELECT * FROM order_items WHERE order_id = ${orderRow.id} ORDER BY id
    `;
    return this.toDomain(orderRow, itemRows);
  }

  /**
   * Insert order + all items atomically using the provided transaction sql object.
   * Items are inserted in a single bulk INSERT to avoid N+1 round-trips.
   */
  async createWithSql(order: Order, txSql: unknown): Promise<void> {
    const sql = txSql as Sql;

    await sql`
      INSERT INTO orders
        (id, customer_id, status, total_amount, currency, idempotency_key, created_at, updated_at)
      VALUES
        (${order.id}, ${order.customerId}, ${order.status},
         ${order.totalAmount.amount}, ${order.currency},
         ${order.idempotencyKey}, ${order.createdAt}, ${order.updatedAt})
    `;

    if (order.items.length > 0) {
      const itemValues = order.items.map((item) => ({
        id: item.id,
        order_id: item.orderId,
        sku: item.sku.value,
        quantity: item.quantity,
        unit_price: item.unitPrice.amount,
      }));
      // Bulk insert — single round trip regardless of item count
      await sql`INSERT INTO order_items ${sql(itemValues)}`;
    }
  }

  async updateStatus(id: string, status: OrderStatus, txSql?: unknown): Promise<void> {
    const sql = (txSql as Sql | undefined) ?? getSql();
    await sql`UPDATE orders SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
  }

  private toDomain(row: OrderRow, itemRows: OrderItemRow[]): Order {
    const items: OrderItem[] = itemRows.map((ir) => ({
      id: ir.id,
      orderId: ir.order_id,
      sku: new SKU(ir.sku),
      quantity: ir.quantity,
      unitPrice: new Money(ir.unit_price, row.currency),
    }));

    return {
      id: row.id,
      customerId: row.customer_id,
      status: row.status,
      totalAmount: new Money(row.total_amount, row.currency),
      currency: row.currency,
      idempotencyKey: row.idempotency_key,
      items,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
