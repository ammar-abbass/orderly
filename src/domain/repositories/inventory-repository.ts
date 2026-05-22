import { getSql } from '../../infrastructure/database/connection.js';
import type { IInventoryRepository, InventoryRecord } from './interfaces.js';

interface InventoryRow {
  sku: string;
  quantity_available: number;
  quantity_reserved: number;
  version: number;
}

export class InventoryRepository implements IInventoryRepository {
  async findBySku(sku: string): Promise<InventoryRecord | null> {
    const sql = getSql();
    const [row] = await sql<InventoryRow[]>`
      SELECT * FROM inventory WHERE sku = ${sku}
    `;
    return row ? this.toDomain(row) : null;
  }

  /**
   * Atomically decrement available and increment reserved.
   * Uses CHECK constraint on quantity_available >= 0 as final safety net.
   */
  async reserve(sku: string, quantity: number): Promise<boolean> {
    const sql = getSql();
    const rows = await sql<{ id: string }[]>`
      UPDATE inventory
      SET quantity_available = quantity_available - ${quantity},
          quantity_reserved  = quantity_reserved  + ${quantity},
          version            = version + 1
      WHERE sku = ${sku}
        AND quantity_available >= ${quantity}
      RETURNING sku
    `;
    return rows.length > 0;
  }

  async release(sku: string, quantity: number): Promise<boolean> {
    const sql = getSql();
    const rows = await sql<{ sku: string }[]>`
      UPDATE inventory
      SET quantity_available = quantity_available + ${quantity},
          quantity_reserved  = GREATEST(0, quantity_reserved - ${quantity}),
          version            = version + 1
      WHERE sku = ${sku}
      RETURNING sku
    `;
    return rows.length > 0;
  }

  async seedInventory(items: { sku: string; quantity: number }[]): Promise<void> {
    const sql = getSql();
    for (const item of items) {
      await sql`
        INSERT INTO inventory (sku, quantity_available, quantity_reserved, version)
        VALUES (${item.sku}, ${item.quantity}, 0, 1)
        ON CONFLICT (sku) DO UPDATE
          SET quantity_available = EXCLUDED.quantity_available,
              quantity_reserved  = 0,
              version            = inventory.version + 1
      `;
    }
  }

  private toDomain(row: InventoryRow): InventoryRecord {
    return {
      sku: row.sku,
      available: row.quantity_available,
      reserved: row.quantity_reserved,
      version: row.version,
    };
  }
}
