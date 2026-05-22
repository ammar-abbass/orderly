/**
 * TransactionManager port — domain-level interface for database transactions.
 *
 * Decouples domain services from the concrete postgres.js `sql.begin()` call.
 * The composition root provides the real PostgreSQL transaction implementation.
 *
 * Usage:
 *   await transactionManager.begin(async (tx) => {
 *     await orderRepo.createWithSql(order, tx);
 *     await outboxRepo.createWithSql(event, tx);
 *   });
 */
export interface ITransactionManager {
  begin<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}
