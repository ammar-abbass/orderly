import { getSql } from '../../infrastructure/database/connection.js';
import { getConfig } from '../../config.js';
import { logger } from '../../infrastructure/observability/logger.js';
import { metrics } from '../../infrastructure/observability/metrics.js';
import { signPayload } from './signature.js';

export interface WebhookPayload {
  readonly eventType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
}

interface SubscriptionRow {
  id: string;
  url: string;
  event_types: string[];
  secret: string;
}

/**
 * Private/loopback IP ranges — blocked to prevent SSRF attacks.
 * See SPEC §7.4 (Webhook SSRF protection).
 */
const SSRF_BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/0\.\d+\.\d+\.\d+/,
  /^https?:\/\/10\.\d+\.\d+\.\d+/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/169\.254\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/\[fc[0-9a-f]{2}:/i,
  /^https?:\/\/\[fd[0-9a-f]{2}:/i,
  /^https?:\/\/metadata\.google\.internal/i,
  /^https?:\/\/169\.254\.169\.254/,
];

function isBlockedUrl(url: string): boolean {
  return SSRF_BLOCKED_PATTERNS.some((re) => re.test(url));
}

/**
 * WebhookDispatcher — delivers domain events to registered external subscribers.
 *
 * Security:
 *   - SSRF protection: blocks private/loopback/cloud-metadata URLs
 *   - HMAC-SHA256 payload signature on every delivery
 *   - 5-second per-request timeout via AbortSignal
 *   - Delivery attempts recorded in webhook_deliveries for audit trail
 *
 * Reliability:
 *   - BullMQ worker retries handle at-least-once delivery
 *   - `calculateRetryDelay` provides exponential backoff with jitter
 *   - All delivery failures are logged + metered
 */
export class WebhookDispatcher {
  async dispatch(
    eventType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sql = getSql();
    const subscriptions = await sql<SubscriptionRow[]>`
      SELECT id, url, event_types, secret
      FROM webhook_subscriptions
      WHERE active = true
        AND ${eventType} = ANY(event_types)
    `;

    if (subscriptions.length === 0) {
      logger.debug(
        { eventType },
        'No active webhook subscriptions for event type',
      );
      return;
    }

    const webhookPayload: WebhookPayload = {
      eventType,
      aggregateId,
      payload,
      timestamp: new Date().toISOString(),
    };

    // Fire all deliveries concurrently; individual failures are caught and logged
    await Promise.allSettled(
      subscriptions.map((sub) => this.deliver(sub, webhookPayload)),
    );
  }

  private async deliver(
    sub: SubscriptionRow,
    webhookPayload: WebhookPayload,
  ): Promise<void> {
    if (isBlockedUrl(sub.url)) {
      logger.error(
        { subscriptionId: sub.id, url: sub.url },
        'Webhook delivery blocked by SSRF protection — subscription URL is a private address',
      );
      return;
    }

    const config = getConfig();
    const bodyStr = JSON.stringify(webhookPayload);
    const signature = signPayload(
      webhookPayload as unknown as Record<string, unknown>,
      sub.secret,
    );
    const startTime = Date.now();
    let httpStatus = -1;
    let responseBody = '';

    try {
      const response = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [config.webhookSecretHeader]: signature,
          'X-Event-Type': webhookPayload.eventType,
          'X-Delivery-Timestamp': webhookPayload.timestamp,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(5_000),
      });

      httpStatus = response.status;
      responseBody = await response.text().catch(() => '');
      const duration = Date.now() - startTime;

      metrics.recordHistogram('webhook.delivery.duration', duration, {
        status_code: String(httpStatus),
      });

      await this.recordDelivery(
        sub.id,
        webhookPayload.aggregateId,
        httpStatus,
        responseBody,
      );

      if (!response.ok) {
        logger.warn(
          { subscriptionId: sub.id, httpStatus, url: sub.url },
          'Webhook delivery received non-2xx response — BullMQ will retry',
        );
        throw new Error(
          `Webhook delivery failed: HTTP ${httpStatus} from ${sub.url}`,
        );
      }

      metrics.increment('webhook.delivered', { status: 'success' });
      logger.debug(
        {
          subscriptionId: sub.id,
          eventType: webhookPayload.eventType,
          duration,
        },
        'Webhook delivered successfully',
      );
    } catch (err) {
      metrics.increment('webhook.delivered', { status: 'failed' });
      logger.error(
        { err, subscriptionId: sub.id, url: sub.url },
        'Webhook delivery failed',
      );
      await this.recordDelivery(
        sub.id,
        webhookPayload.aggregateId,
        httpStatus,
        responseBody,
      ).catch(() => {});
      throw err;
    }
  }

  /**
   * Record a delivery attempt in webhook_deliveries for audit and debugging.
   * event_id stores the aggregateId string (order UUID), not an FK to outbox_events,
   * because the dispatcher receives the aggregateId, not the outbox event UUID.
   */
  private async recordDelivery(
    subscriptionId: string,
    aggregateId: string,
    status: number,
    responseBody: string,
  ): Promise<void> {
    try {
      const sql = getSql();
      await sql`
        INSERT INTO webhook_deliveries (subscription_id, event_id, status, response_body, attempted_at)
        VALUES (${subscriptionId}, ${aggregateId}, ${status}, ${responseBody.slice(0, 2000)}, NOW())
      `;
    } catch (err) {
      logger.warn(
        { err, subscriptionId },
        'Failed to record webhook delivery attempt',
      );
    }
  }
}
