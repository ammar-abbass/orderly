/**
 * Domain metrics port — decouples domain services from the concrete
 * metrics implementation in src/infrastructure/observability/metrics.ts.
 *
 * The composition root binds the real metrics collector to this interface.
 */
export interface IMetrics {
  increment(name: string, tags?: Record<string, string>): void;
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void;
}
