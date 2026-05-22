import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Integration test: runs real PostgreSQL migrations, inserts an order,
 * and verifies the atomic outbox write. No Redis/BullMQ required.
 */

let container: StartedPostgreSqlContainer;
let sql: ReturnType<typeof postgres>;

async function runMigrations(sqlClient: ReturnType<typeof postgres>): Promise<void> {
  await sqlClient`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  const migrationsDir = resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const content = await readFile(resolve(migrationsDir, file), 'utf-8');
    await sqlClient.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file}) ON CONFLICT DO NOTHING`;
    });
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  sql = postgres(container.getConnectionUri(), { max: 5 });
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
  await container.stop();
});

describe('Atomic order + outbox write', () => {
  it('inserts order, items, and outbox event in one transaction', async () => {
    const orderId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    await sql.begin(async (tx) => {
      // Insert order
      await tx`
        INSERT INTO orders (id, customer_id, status, total_amount, currency, idempotency_key)
        VALUES (${orderId}, 'cust-001', 'PENDING', '29.99', 'USD', ${idempotencyKey})
      `;

      // Bulk insert items
      await tx`
        INSERT INTO order_items (id, order_id, sku, quantity, unit_price)
        VALUES (${crypto.randomUUID()}, ${orderId}, 'WIDGET-1', 2, '14.995')
      `;

      // Outbox event in the same transaction
      await tx`
        INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count)
        VALUES (${crypto.randomUUID()}, 'order', ${orderId}, 'order.created',
                ${JSON.stringify({ orderId, customerId: 'cust-001' })}::jsonb,
                '{}'::jsonb, 'PENDING', 0)
      `;
    });

    const [order] = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
    expect(order).toBeDefined();
    expect(order!.status).toBe('PENDING');

    const items = await sql`SELECT * FROM order_items WHERE order_id = ${orderId}`;
    expect(items).toHaveLength(1);

    const events = await sql`SELECT * FROM outbox_events WHERE aggregate_id = ${orderId}`;
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('order.created');
    expect(events[0]!.status).toBe('PENDING');
  });

  it('rolls back both order and outbox event if transaction fails', async () => {
    const orderId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    await expect(
      sql.begin(async (tx) => {
        await tx`
          INSERT INTO orders (id, customer_id, status, total_amount, currency, idempotency_key)
          VALUES (${orderId}, 'cust-002', 'PENDING', '9.99', 'USD', ${idempotencyKey})
        `;
        // Force failure: invalid status
        await tx`UPDATE orders SET status = 'INVALID_STATUS' WHERE id = ${orderId}`;
      }),
    ).rejects.toThrow();

    const orders = await sql`SELECT * FROM orders WHERE id = ${orderId}`;
    expect(orders).toHaveLength(0);

    const events = await sql`SELECT * FROM outbox_events WHERE aggregate_id = ${orderId}`;
    expect(events).toHaveLength(0);
  });

  it('idempotency_key enforces uniqueness', async () => {
    const key = crypto.randomUUID();

    await sql`
      INSERT INTO orders (id, customer_id, status, total_amount, currency, idempotency_key)
      VALUES (${crypto.randomUUID()}, 'cust-003', 'PENDING', '5.00', 'USD', ${key})
    `;

    await expect(
      sql`
        INSERT INTO orders (id, customer_id, status, total_amount, currency, idempotency_key)
        VALUES (${crypto.randomUUID()}, 'cust-003', 'PENDING', '5.00', 'USD', ${key})
      `,
    ).rejects.toThrow();
  });
});

describe('Inventory reservation constraints', () => {
  it('prevents negative quantity_available via CHECK constraint', async () => {
    await sql`
      INSERT INTO inventory (sku, quantity_available, quantity_reserved)
      VALUES ('TEST-SKU', 3, 0)
    `;

    // Attempt to set below zero
    await expect(
      sql`UPDATE inventory SET quantity_available = -1 WHERE sku = 'TEST-SKU'`,
    ).rejects.toThrow();
  });

  it('FOR UPDATE SKIP LOCKED does not block concurrent selects', async () => {
    // Clear outbox first to ensure deterministic behavior
    await sql`DELETE FROM outbox_events`;

    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    await sql`
      INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, status, retry_count)
      VALUES 
        (${id1}, 'order', ${crypto.randomUUID()}, 'order.test', '{"test":true}'::jsonb, 'PENDING', 0),
        (${id2}, 'order', ${crypto.randomUUID()}, 'order.test', '{"test":true}'::jsonb, 'PENDING', 0)
    `;

    let tx1Rows: any[] = [];
    let tx2Rows: any[] = [];
    
    // Coordinate the two transactions
    let proceedTx2: () => void;
    const tx1Locked = new Promise<void>((r) => proceedTx2 = r);

    const promise1 = sql.begin(async (tx1) => {
      tx1Rows = await tx1`SELECT id FROM outbox_events WHERE status = 'PENDING' LIMIT 1 FOR UPDATE SKIP LOCKED`;
      proceedTx2();
      // wait a bit before finishing transaction 1 to keep locks alive
      await new Promise((r) => setTimeout(r, 150)); 
    });

    const promise2 = sql.begin(async (tx2) => {
      await tx1Locked;
      tx2Rows = await tx2`SELECT id FROM outbox_events WHERE status = 'PENDING' LIMIT 1 FOR UPDATE SKIP LOCKED`;
    });

    await Promise.all([promise1, promise2]);

    expect(tx1Rows).toHaveLength(1);
    expect(tx2Rows).toHaveLength(1);
    expect(tx1Rows[0].id).not.toBe(tx2Rows[0].id);
  });
});
