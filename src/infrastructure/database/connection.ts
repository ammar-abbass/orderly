import postgres from 'postgres';
import { getConfig } from '../../config.js';

let sqlInstance: ReturnType<typeof postgres> | null = null;

export function getSql(): ReturnType<typeof postgres> {
  if (sqlInstance) return sqlInstance;

  const config = getConfig();
  sqlInstance = postgres(config.databaseUrl, {
    max: config.databasePoolSize,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
    types: {
      // Return NUMERIC columns as strings to preserve decimal precision
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
    onnotice: () => {},
    debug: config.nodeEnv === 'development',
  });

  return sqlInstance;
}

export async function closeDatabase(): Promise<void> {
  if (sqlInstance) {
    await sqlInstance.end({ timeout: 5 });
    sqlInstance = null;
  }
}
