import { describe, it, expect } from 'vitest';
import { IdempotencyStore } from '../../src/infrastructure/redis/idempotency-store.js';

/**
 * Idempotency integration tests.
 * Requires Redis running at the URL in REDIS_URL env var.
 * In CI, use: docker run -d -p 6379:6379 redis:7-alpine
 */

describe('IdempotencyStore', () => {
  const store = new IdempotencyStore();

  it('returns null for unknown key', async () => {
    const result = await store.get('client-1', `unknown-${Date.now()}`);
    expect(result).toBeNull();
  });

  it('stores and retrieves a record', async () => {
    const clientId = `client-${Date.now()}`;
    const key = crypto.randomUUID();
    const record = {
      requestId: 'req-1',
      status: 201,
      response: JSON.stringify({ id: 'order-1' }),
      requestHash: 'abc123',
      createdAt: new Date().toISOString(),
    };

    await store.set(clientId, key, record);
    const retrieved = await store.get(clientId, key);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.requestId).toBe('req-1');
    expect(retrieved?.status).toBe(201);
    expect(retrieved?.requestHash).toBe('abc123');
  });

  it('deletes a record', async () => {
    const clientId = `client-del-${Date.now()}`;
    const key = crypto.randomUUID();
    await store.set(clientId, key, {
      requestId: 'req-del',
      status: 201,
      response: '{}',
      requestHash: 'hash',
      createdAt: new Date().toISOString(),
    });

    await store.delete(clientId, key);
    const result = await store.get(clientId, key);
    expect(result).toBeNull();
  });

  it('different clients have isolated namespaces', async () => {
    const key = crypto.randomUUID();
    const record = {
      requestId: 'req-2',
      status: 201,
      response: '{}',
      requestHash: 'xyz',
      createdAt: new Date().toISOString(),
    };

    await store.set('client-a', key, record);
    const resultB = await store.get('client-b', key);
    expect(resultB).toBeNull();
  });
});
