/**
 * ResiliencePolicy port — domain-level interface for circuit breaker + retry.
 *
 * The infrastructure layer provides the cockatiel-based implementation.
 * MUST be a singleton so failure counters accumulate across invocations.
 */
export interface ResiliencePolicy {
  execute<T>(fn: () => Promise<T>): Promise<T>;
}
