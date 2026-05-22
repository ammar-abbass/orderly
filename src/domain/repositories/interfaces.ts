import type { Order, OrderStatus } from '../entities/order.js';
import type { SagaInstance, SagaStep } from '../entities/saga.js';
import type { OutboxEvent } from './outbox-repository.js';

// ─── Order ──────────────────────────────────────────────────────────────────

export interface IOrderRepository {
  findById(id: string): Promise<Order | null>;
  findByIdempotencyKey(key: string): Promise<Order | null>;
  /** Atomically create order + items within caller-supplied transaction */
  createWithSql(order: Order, sql: unknown): Promise<void>;
  updateStatus(id: string, status: OrderStatus, sql?: unknown): Promise<void>;
}

// ─── Outbox ─────────────────────────────────────────────────────────────────

export interface IOutboxRepository {
  /** Create an outbox event — accepts optional transaction sql for atomic writes */
  createWithSql(
    event: Omit<OutboxEvent, 'id' | 'createdAt' | 'processedAt'>,
    sql: unknown,
  ): Promise<string>;
  getPending(limit: number): Promise<OutboxEvent[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, incrementRetry: boolean): Promise<void>;
  resetForRetry(id: string): Promise<void>;
}

// ─── Saga ────────────────────────────────────────────────────────────────────

export interface ISagaRepository {
  findById(id: string): Promise<SagaInstance | null>;
  findByOrderId(orderId: string): Promise<SagaInstance | null>;
  findRunningSagas(olderThanMinutes: number): Promise<SagaInstance[]>;
  create(saga: SagaInstance): Promise<void>;
  update(saga: SagaInstance): Promise<void>;
  createStep(step: SagaStep): Promise<void>;
  updateStep(step: SagaStep): Promise<void>;
  getSteps(sagaId: string): Promise<SagaStep[]>;
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export interface InventoryRecord {
  sku: string;
  available: number;
  reserved: number;
  version: number;
}

export interface IInventoryRepository {
  findBySku(sku: string): Promise<InventoryRecord | null>;
  reserve(sku: string, quantity: number): Promise<boolean>;
  release(sku: string, quantity: number): Promise<boolean>;
  seedInventory(items: { sku: string; quantity: number }[]): Promise<void>;
}
