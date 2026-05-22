/**
 * Seed script — populates inventory for local development and load testing.
 * Run: pnpm run seed
 */
import { getSql, closeDatabase } from '../src/infrastructure/database/connection.js';

// Override env for script usage
process.env['NODE_ENV'] = process.env['NODE_ENV'] ?? 'development';

const SEED_INVENTORY = [
  { sku: 'WIDGET-1',    quantity: 10_000 },
  { sku: 'WIDGET-2',    quantity: 5_000  },
  { sku: 'WIDGET-3',    quantity: 1_000  },
  { sku: 'WIDGET-RARE', quantity: 50     },
  { sku: 'WIDGET-OOS',  quantity: 0      },
];

async function seed(): Promise<void> {
  const sql = getSql();
  console.log('Seeding inventory...');

  for (const item of SEED_INVENTORY) {
    await sql`
      INSERT INTO inventory (sku, quantity_available, quantity_reserved, version)
      VALUES (${item.sku}, ${item.quantity}, 0, 1)
      ON CONFLICT (sku) DO UPDATE
        SET quantity_available = EXCLUDED.quantity_available,
            quantity_reserved  = 0,
            version            = inventory.version + 1
    `;
    console.log(`  ✅ ${item.sku}: ${item.quantity} units`);
  }

  // Seed a test webhook subscription for development
  await sql`
    INSERT INTO webhook_subscriptions (id, url, event_types, secret, active)
    VALUES (
      '00000000-0000-4000-a000-000000000000',
      'https://webhook.site/dev',
      ARRAY['order.created', 'order.paid', 'order.failed'],
      'dev-secret-key-replace-in-prod',
      false
    )
    ON CONFLICT (id) DO NOTHING
  `;
  console.log('  ✅ Webhook subscription (inactive by default)');

  console.log('Seed complete.');
}

seed()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    process.exit();
  });
