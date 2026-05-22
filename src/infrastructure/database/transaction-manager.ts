import { getSql } from './connection.js';
import type { ITransactionManager } from '../../domain/ports/transaction-manager.js';

/**
 * PostgreSQL transaction manager implementation.
 *
 * Wraps postgres.js `sql.begin()` behind the domain ITransactionManager port.
 * This allows domain services to use transactions without importing
 * postgres.js directly, preserving the domain↔infrastructure boundary.
 */
export class PostgresTransactionManager implements ITransactionManager {
  async begin<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const sql = getSql();
    return sql.begin(async (tx) => fn(tx)) as Promise<T>;
  }
}
