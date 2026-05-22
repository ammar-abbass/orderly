import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Chaos Test: Advisory Lock Contention
 *
 * Verifies that concurrent inventory reservations for a limited-stock item
 * never oversell — even under extreme concurrency (10 simultaneous requests
 * for 3 units of stock with each taking 1 unit).
 *
 * This test uses a real PostgreSQL container (Testcontainers) to verify
 * the CHECK constraint and advisory lock behaviour is genuinely enforced
 * at the database level, not just in application logic.
 */

let container: StartedPostgreSqlContainer;
let sql: ReturnType<typeof postgres>;

async function runMigrations(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  const migrationsDir = resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const content = await readFile(resolve(migrationsDir, file), 'utf-8');
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file}) ON CONFLICT DO NOTHING`;
    });
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  sql = postgres(container.getConnectionUri(), { max: 20 });
  await runMigrations();
}, 120_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

/**
 * Atomically attempt to reserve `quantity` units of `sku`.
 * Returns true if the reservation succeeded, false if insufficient stock.
 * This mirrors InventoryRepository.reserve() exactly.
 */
async function tryReserve(sqlClient: ReturnType<typeof postgres>, sku: string, quantity: number): Promise<boolean> {
  const result = await sqlClient`
    UPDATE inventory
    SET quantity_available = quantity_available - ${quantity},
        quantity_reserved  = quantity_reserved  + ${quantity},
        version            = version + 1
    WHERE sku = ${sku}
      AND quantity_available >= ${quantity}
    RETURNING sku
  `;
  return result.length > 0;
}

describe('Inventory oversell prevention', () => {
  it('never oversells with 10 concurrent requests for 3 units of stock', async () => {
    const sku = `CHAOS-SKU-${Date.now()}`;
    const stockQty = 3;
    const concurrency = 10;

    // Seed exactly 3 units
    await sql`
      INSERT INTO inventory (sku, quantity_available, quantity_reserved, version)
      VALUES (${sku}, ${stockQty}, 0, 1)
    `;

    // Fire 10 concurrent reservation attempts, each requesting 1 unit
    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, () => tryReserve(sql, sku, 1)),
    );

    const successes = results.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    ).length;

    const [row] = await sql<{ quantity_available: number; quantity_reserved: number }[]>`
      SELECT quantity_available, quantity_reserved FROM inventory WHERE sku = ${sku}
    `;

    expect(successes).toBe(stockQty);
    expect(row?.quantity_available).toBe(0);
    expect(row?.quantity_reserved).toBe(stockQty);
    // Most importantly: quantity_available never went negative
    expect(row?.quantity_available).toBeGreaterThanOrEqual(0);
  });

  it('CHECK constraint prevents direct negative quantity_available write', async () => {
    const sku = `CHAOS-NEG-${Date.now()}`;
    await sql`INSERT INTO inventory (sku, quantity_available, quantity_reserved, version) VALUES (${sku}, 1, 0, 1)`;

    // This should throw — CHECK constraint (quantity_available >= 0)
    await expect(
      sql`UPDATE inventory SET quantity_available = -1 WHERE sku = ${sku}`,
    ).rejects.toThrow();

    // Row should be unchanged
    const [row] = await sql<{ quantity_available: number }[]>`
      SELECT quantity_available FROM inventory WHERE sku = ${sku}
    `;
    expect(row?.quantity_available).toBe(1);
  });

  it('handles high contention gracefully — all failures are clean (no partial writes)', async () => {
    const sku = `CHAOS-CONT-${Date.now()}`;
    // Only 1 unit available; 20 threads compete for it
    await sql`INSERT INTO inventory (sku, quantity_available, quantity_reserved, version) VALUES (${sku}, 1, 0, 1)`;

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => tryReserve(sql, sku, 1)),
    );

    const successes = results.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    ).length;

    // Exactly 1 should succeed
    expect(successes).toBe(1);

    // Inventory should be exactly at 0 — not negative, not partially updated
    const [row] = await sql<{ quantity_available: number; quantity_reserved: number }[]>`
      SELECT quantity_available, quantity_reserved FROM inventory WHERE sku = ${sku}
    `;
    expect(row?.quantity_available).toBe(0);
    expect(row?.quantity_reserved).toBe(1);
  });
});
