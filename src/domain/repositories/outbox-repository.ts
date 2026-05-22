import type { Sql } from 'postgres';
import { getSql } from '../../infrastructure/database/connection.js';
import type { IOutboxRepository } from './interfaces.js';

export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface OutboxEvent {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly headers: Record<string, unknown>;
  readonly status: OutboxStatus;
  readonly retryCount: number;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
}

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  status: OutboxStatus;
  retry_count: number;
  created_at: Date;
  processed_at: Date | null;
}

/**
 * Serialise any value to a JSON-compatible type for postgres.js sql.json().
 * postgres.js v3 requires a concrete JSON type, not `unknown`.
 */
function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class OutboxRepository implements IOutboxRepository {
  /**
   * Write an outbox event using the supplied transaction sql object.
   * MUST be called within the same db.begin() transaction as the business entity write.
   * This guarantees at-least-once delivery: if the process crashes after commit,
   * the outbox poller will replay the event.
   */
  async createWithSql(
    event: Omit<OutboxEvent, 'id' | 'createdAt' | 'processedAt'>,
    txSql: unknown,
  ): Promise<string> {
    const sql = txSql as Sql;
    const id = crypto.randomUUID();
    // Use JSON.stringify + ::jsonb cast to sidestep postgres.js JSONValue type constraint
    await sql`
      INSERT INTO outbox_events
        (id, aggregate_type, aggregate_id, event_type, payload, headers, status, retry_count, created_at)
      VALUES (
        ${id},
        ${event.aggregateType},
        ${event.aggregateId},
        ${event.eventType},
        ${toJson(event.payload)}::jsonb,
        ${toJson(event.headers)}::jsonb,
        ${event.status},
        ${event.retryCount},
        NOW()
      )
    `;
    return id;
  }

  async getPending(limit = 100): Promise<OutboxEvent[]> {
    const sql = getSql();
    // FOR UPDATE SKIP LOCKED allows multiple OutboxProcessor instances to run
    // concurrently without double-processing the same event.
    const rows = await sql<OutboxRow[]>`
      SELECT * FROM outbox_events
      WHERE status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    return rows.map((r) => this.toDomain(r));
  }

  async markPublished(id: string): Promise<void> {
    const sql = getSql();
    await sql`
      UPDATE outbox_events
      SET status = 'PUBLISHED', processed_at = NOW()
      WHERE id = ${id}
    `;
  }

  async markFailed(id: string, incrementRetry = true): Promise<void> {
    const sql = getSql();
    if (incrementRetry) {
      await sql`
        UPDATE outbox_events
        SET status = 'FAILED', retry_count = retry_count + 1, processed_at = NOW()
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE outbox_events
        SET status = 'FAILED', processed_at = NOW()
        WHERE id = ${id}
      `;
    }
  }

  async resetForRetry(id: string): Promise<void> {
    const sql = getSql();
    await sql`
      UPDATE outbox_events
      SET status = 'PENDING', retry_count = retry_count + 1
      WHERE id = ${id}
    `;
  }

  private toDomain(row: OutboxRow): OutboxEvent {
    return {
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
      headers: row.headers,
      status: row.status,
      retryCount: row.retry_count,
      createdAt: row.created_at,
      processedAt: row.processed_at,
    };
  }
}
