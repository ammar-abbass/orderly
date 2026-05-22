import dotenv from 'dotenv';

dotenv.config();

function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed))
    throw new Error(`Env var ${key} must be an integer, got: ${raw}`);
  return parsed;
}

export interface AppConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly adminPort: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly databasePoolSize: number;
  readonly redisUrl: string;
  readonly idempotencyTtlSeconds: number;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
  readonly queuePrefix: string;
  readonly queueMaxStalledCount: number;
  readonly outboxPollIntervalMs: number;
  readonly outboxMaxRetries: number;
  readonly webhookMaxRetries: number;
  readonly webhookRetryBaseDelayMs: number;
  readonly webhookSecretHeader: string;
  readonly paymentGatewayApiKey: string;
  readonly paymentGatewayBaseUrl: string;
  readonly paymentCircuitBreakerThreshold: number;
  readonly paymentCircuitBreakerDurationMs: number;
  readonly adminApiKey: string;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const nodeEnv = env('NODE_ENV', 'development');
  const adminApiKey = env('ADMIN_API_KEY', 'dev-admin-key');

  // Guard: refuse to start with insecure defaults outside of development
  if (nodeEnv !== 'development' && adminApiKey === 'dev-admin-key') {
    throw new Error(
      'ADMIN_API_KEY must be set to a secure value in non-development environments. ' +
        'The default "dev-admin-key" is not permitted in production.',
    );
  }

  cachedConfig = {
    nodeEnv,
    port: envInt('PORT', 3000),
    adminPort: envInt('ADMIN_PORT', 3001),
    logLevel: env('LOG_LEVEL', 'info'),
    databaseUrl: env('DATABASE_URL'),
    databasePoolSize: envInt('DATABASE_POOL_SIZE', 20),
    redisUrl: env('REDIS_URL'),
    idempotencyTtlSeconds: envInt('IDEMPOTENCY_TTL_SECONDS', 86400),
    rateLimitMax: envInt('RATE_LIMIT_MAX', 100),
    rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60000),
    queuePrefix: env('QUEUE_PREFIX', 'orderly'),
    queueMaxStalledCount: envInt('QUEUE_MAX_STALLED_COUNT', 2),
    outboxPollIntervalMs: envInt('OUTBOX_POLL_INTERVAL_MS', 500),
    outboxMaxRetries: envInt('OUTBOX_MAX_RETRIES', 5),
    webhookMaxRetries: envInt('WEBHOOK_MAX_RETRIES', 10),
    webhookRetryBaseDelayMs: envInt('WEBHOOK_RETRY_BASE_DELAY_MS', 1000),
    webhookSecretHeader: env('WEBHOOK_SECRET_HEADER', 'X-Webhook-Signature'),
    paymentGatewayApiKey: env('PAYMENT_GATEWAY_API_KEY', ''),
    paymentGatewayBaseUrl: env('PAYMENT_GATEWAY_BASE_URL', ''),
    paymentCircuitBreakerThreshold: envInt(
      'PAYMENT_CIRCUIT_BREAKER_THRESHOLD',
      5,
    ),
    paymentCircuitBreakerDurationMs: envInt(
      'PAYMENT_CIRCUIT_BREAKER_DURATION_MS',
      10000,
    ),
    adminApiKey,
  };

  return cachedConfig;
}

/** Exposed for tests to reset between suites */
export function resetConfig(): void {
  cachedConfig = null;
}
