/**
 * Domain ports — interfaces that define the boundaries between
 * the domain layer and infrastructure. Infrastructure provides
 * concrete implementations; the composition root wires them together.
 *
 * This is the Dependency Inversion Principle in action:
 *   - Domain depends on these interfaces (stable abstractions)
 *   - Infrastructure implements these interfaces (concrete details)
 *   - The composition root (src/index.ts) connects the two
 */

export type { ILogger } from './logger.js';
export type { IMetrics } from './metrics.js';
export type { PaymentGateway, PaymentResult } from './payment-gateway.js';
export type { ResiliencePolicy } from './resilience-policy.js';
export type { LockManager, LockRelease } from './lock-manager.js';
export type { ITransactionManager } from './transaction-manager.js';
