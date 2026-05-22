import { v4 as uuidv4 } from 'uuid';
import {
  createSagaInstance,
  startSaga,
  completeSaga,
  startCompensation,
  completeCompensation,
  createStep,
  completeStep,
  failStep,
  markStepCompensated,
  markStepCompensationFailed,
  type SagaInstance,
  type SagaStep,
} from '../entities/saga.js';
import type { IOrderRepository, IOutboxRepository, ISagaRepository } from '../repositories/interfaces.js';
import type { InventoryService, InventoryReservation } from './inventory-service.js';
import type { PaymentService } from './payment-service.js';
import type { ITransactionManager } from '../ports/transaction-manager.js';
import type { ILogger } from '../ports/logger.js';
import type { IMetrics } from '../ports/metrics.js';
import { Money } from '../value-objects/money.js';

export interface SagaContext {
  readonly orderId: string;
  readonly customerId: string;
  readonly items: readonly InventoryReservation[];
  readonly totalAmount: { amount: string; currency: string };
  readonly paymentToken: string;
}

/**
 * SagaOrchestrator — coordinates the ORDER_FULFILLMENT distributed transaction.
 *
 * Forward steps (in order):
 *   0. RESERVE_INVENTORY  — advisory-locked per-SKU reservation
 *   1. PROCESS_PAYMENT    — circuit-breaker + retry protected charge
 *   2. CONFIRM_ORDER      — order status → PAID
 *   3. EMIT_EVENTS        — write order.paid to outbox_events (transactional)
 *
 * Compensation (reverse order on any step failure):
 *   - REFUND_PAYMENT      — only if PROCESS_PAYMENT completed with a transactionId
 *   - RELEASE_INVENTORY   — reverse reservation
 *   - CANCEL_ORDER        — status → CANCELLED + write order.failed to outbox
 *
 * Immutability contract:
 *   All SagaStep transitions use the pure helpers from saga.ts.
 *   The returned new object is persisted immediately — the original is never mutated.
 *
 * All dependencies injected via constructor — no infrastructure imports.
 */
export class SagaOrchestrator {
  constructor(
    private readonly orderRepo: IOrderRepository,
    private readonly sagaRepo: ISagaRepository,
    private readonly outboxRepo: IOutboxRepository,
    private readonly inventoryService: InventoryService,
    private readonly paymentService: PaymentService,
    private readonly txManager: ITransactionManager,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
  ) {}

  async startSaga(context: SagaContext): Promise<SagaInstance> {
    // Create and persist saga
    const saga = createSagaInstance(uuidv4(), context.orderId);
    await this.sagaRepo.create(saga);
    const running = startSaga(saga);
    await this.sagaRepo.update(running);

    this.logger.info({ sagaId: running.id, orderId: context.orderId }, 'Saga started');

    // ── Step 0: RESERVE_INVENTORY ──────────────────────────────────────────
    const step0 = await this.beginStep(running.id, 'RESERVE_INVENTORY', 0, { items: context.items });

    const reserved = await this.inventoryService.reserveInventory(context.orderId, context.items);
    if (!reserved) {
      await this.endStep(failStep(step0, 'Insufficient inventory or lock contention'));
      return this.compensate(running.id, context, running);
    }
    await this.endStep(completeStep(step0, { reserved: true }));

    // ── Step 1: PROCESS_PAYMENT ────────────────────────────────────────────
    const step1 = await this.beginStep(running.id, 'PROCESS_PAYMENT', 1, { orderId: context.orderId });

    const paymentResult = await this.paymentService.charge({
      orderId: context.orderId,
      amount: new Money(context.totalAmount.amount, context.totalAmount.currency),
      paymentToken: context.paymentToken,
    });

    if (!paymentResult.success) {
      await this.endStep(failStep(step1, paymentResult.errorMessage ?? 'Payment declined'));
      return this.compensate(running.id, context, running);
    }
    await this.endStep(completeStep(step1, { transactionId: paymentResult.transactionId }));

    // ── Step 2: CONFIRM_ORDER + Step 3: EMIT_EVENTS (atomic) ───────────────
    // Both the order status update and the outbox event are written in a single
    // transaction to guarantee consistency.
    const step2 = await this.beginStep(running.id, 'CONFIRM_ORDER', 2, { orderId: context.orderId });
    const step3 = await this.beginStep(running.id, 'EMIT_EVENTS', 3, { orderId: context.orderId });

    await this.txManager.begin(async (tx) => {
      await this.orderRepo.updateStatus(context.orderId, 'PAID', tx);
      await this.outboxRepo.createWithSql(
        {
          aggregateType: 'order',
          aggregateId: context.orderId,
          eventType: 'order.paid',
          payload: {
            orderId: context.orderId,
            transactionId: paymentResult.transactionId,
            amount: context.totalAmount,
            queue: 'webhook-delivery',
          },
          headers: {},
          status: 'PENDING',
          retryCount: 0,
        },
        tx,
      );
    });

    await this.endStep(completeStep(step2, { status: 'PAID' }));
    await this.endStep(completeStep(step3, { outboxEventWritten: true }));

    // ── Complete saga ──────────────────────────────────────────────────────
    const completed = completeSaga(running);
    await this.sagaRepo.update(completed);
    this.metrics.increment('saga.completed');
    this.logger.info({ sagaId: running.id, orderId: context.orderId }, 'Saga completed successfully');

    return completed;
  }

  /**
   * Compensate a failed saga. Reads persisted step state from DB to determine
   * which steps completed and whether a refund is needed.
   *
   * Can be triggered automatically (from startSaga on failure) or manually
   * via the Admin API.
   */
  async compensate(
    sagaId: string,
    context: SagaContext,
    currentSaga: SagaInstance,
  ): Promise<SagaInstance> {
    const compensating = startCompensation(currentSaga);
    await this.sagaRepo.update(compensating);
    this.logger.warn({ sagaId, orderId: context.orderId }, 'Starting saga compensation');

    // Determine whether payment was actually charged by reading persisted DB state
    const steps = await this.sagaRepo.getSteps(sagaId);
    const paymentStep = steps.find(
      (s) => s.stepName === 'PROCESS_PAYMENT' && s.status === 'COMPLETED',
    );
    const transactionId =
      paymentStep?.outputPayload != null &&
      typeof paymentStep.outputPayload === 'object' &&
      'transactionId' in paymentStep.outputPayload
        ? ((paymentStep.outputPayload as Record<string, unknown>)['transactionId'] as string | null)
        : null;

    // Compensate: refund (only if charged)
    if (transactionId) {
      const refundResult = await this.paymentService.refund(
        transactionId,
        new Money(context.totalAmount.amount, context.totalAmount.currency),
      );
      const refundStep = steps.find((s) => s.stepName === 'PROCESS_PAYMENT');
      if (refundStep) {
        const updated = refundResult.success
          ? markStepCompensated(refundStep)
          : markStepCompensationFailed(refundStep, refundResult.errorMessage ?? 'Refund failed');
        await this.sagaRepo.updateStep(updated);
      }
      if (!refundResult.success) {
        this.logger.error(
          { sagaId, transactionId, error: refundResult.errorMessage },
          'Refund failed during compensation — requires manual resolution',
        );
      }
    }

    // Compensate: release inventory
    const inventoryReleased = await this.inventoryService.releaseInventory(
      context.orderId,
      context.items,
    );
    const inventoryStep = steps.find((s) => s.stepName === 'RESERVE_INVENTORY');
    if (inventoryStep) {
      const updated = inventoryReleased
        ? markStepCompensated(inventoryStep)
        : markStepCompensationFailed(inventoryStep, 'Release failed');
      await this.sagaRepo.updateStep(updated);
    }

    // Cancel the order and write failure event atomically
    await this.txManager.begin(async (tx) => {
      await this.orderRepo.updateStatus(context.orderId, 'CANCELLED', tx);
      await this.outboxRepo.createWithSql(
        {
          aggregateType: 'order',
          aggregateId: context.orderId,
          eventType: 'order.failed',
          payload: {
            orderId: context.orderId,
            reason: 'Saga compensation executed',
            queue: 'webhook-delivery',
          },
          headers: {},
          status: 'PENDING',
          retryCount: 0,
        },
        tx,
      );
    }).catch((err: unknown) =>
      this.logger.error({ err, orderId: context.orderId }, 'Failed to write order.failed outbox event'),
    );

    const failed = completeCompensation(compensating);
    await this.sagaRepo.update(failed);
    this.metrics.increment('saga.compensated');
    this.logger.info({ sagaId, orderId: context.orderId }, 'Saga compensation complete');

    return failed;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Create a new step in RUNNING state and persist it.
   * Returns the persisted step for subsequent transition calls.
   */
  private async beginStep(
    sagaId: string,
    stepName: string,
    stepOrder: number,
    input: unknown,
  ): Promise<SagaStep> {
    const step = createStep(uuidv4(), sagaId, stepName, stepOrder, input);
    await this.sagaRepo.createStep(step);
    return step;
  }

  /**
   * Persist a step that has transitioned (COMPLETED or FAILED).
   * Returns the same step for chaining.
   */
  private async endStep(step: SagaStep): Promise<SagaStep> {
    await this.sagaRepo.updateStep(step);
    return step;
  }
}
