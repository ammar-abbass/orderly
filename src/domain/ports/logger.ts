/**
 * Domain logger port — decouples domain services from the concrete
 * Pino logger in src/infrastructure/observability/logger.ts.
 *
 * The composition root binds the real Pino logger to this interface.
 */
export interface ILogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}
