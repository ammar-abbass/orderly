import { afterAll, beforeAll } from 'vitest';

// Extend timeout for integration tests that spin up containers
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'error';

// Prevent config from rejecting missing env vars in tests
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://localhost/test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
process.env['ADMIN_API_KEY'] = 'test-admin-key';

beforeAll(() => {
  // Global test hooks
});

afterAll(async () => {
  // Ensure async handles are closed
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
});
