import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { getSql, closeDatabase } from './connection.js';

interface MigrationRecord {
  id: number;
  name: string;
  applied_at: Date;
}

async function ensureMigrationsTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function runMigrations(): Promise<void> {
  const sql = getSql();
  await ensureMigrationsTable();

  const migrationsDir = resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = await sql<MigrationRecord[]>`SELECT name FROM schema_migrations ORDER BY id`;
  const appliedSet = new Set(applied.map((m) => m.name));

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`⏭  Skipping already-applied migration: ${file}`);
      continue;
    }

    const path = resolve(migrationsDir, file);
    const content = await readFile(path, 'utf-8');

    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });

    console.log(`✅ Applied migration: ${file}`);
  }

  console.log('Migrations complete.');
}

// CLI entrypoint: `pnpm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('Migration failed:', err);
      process.exit(1);
    })
    .finally(() => closeDatabase());
}
