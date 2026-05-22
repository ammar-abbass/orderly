import { getSql } from '../../infrastructure/database/connection.js';
import type {
  SagaInstance,
  SagaStatus,
  SagaStep,
  StepStatus,
  CompensationStatus,
} from '../entities/saga.js';
import type { ISagaRepository } from './interfaces.js';

interface SagaRow {
  id: string;
  order_id: string;
  type: string;
  status: SagaStatus;
  current_step: number;
  started_at: Date;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
}

interface SagaStepRow {
  id: string;
  saga_id: string;
  step_name: string;
  step_order: number;
  status: string;
  input_payload: unknown;
  output_payload: unknown;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  compensation_status: string;
  compensation_error: string | null;
}

/**
 * Serialise any value to a JSON-compatible string for postgres.js ::jsonb casts.
 * This sidesteps the `JSONValue` type constraint in postgres.js v3.
 */
function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class SagaRepository implements ISagaRepository {
  async findById(id: string): Promise<SagaInstance | null> {
    const sql = getSql();
    const [row] = await sql<SagaRow[]>`SELECT * FROM saga_instances WHERE id = ${id}`;
    return row ? this.toDomainSaga(row) : null;
  }

  async findByOrderId(orderId: string): Promise<SagaInstance | null> {
    const sql = getSql();
    const [row] = await sql<SagaRow[]>`
      SELECT * FROM saga_instances WHERE order_id = ${orderId}
    `;
    return row ? this.toDomainSaga(row) : null;
  }

  async findRunningSagas(olderThanMinutes = 10): Promise<SagaInstance[]> {
    const sql = getSql();
    const rows = await sql<SagaRow[]>`
      SELECT * FROM saga_instances
      WHERE status IN ('RUNNING', 'COMPENSATING')
        AND started_at < NOW() - (${olderThanMinutes} || ' minutes')::INTERVAL
      ORDER BY started_at ASC
    `;
    return rows.map((r) => this.toDomainSaga(r));
  }

  async create(saga: SagaInstance): Promise<void> {
    const sql = getSql();
    await sql`
      INSERT INTO saga_instances
        (id, order_id, type, status, current_step, started_at, completed_at, metadata)
      VALUES (
        ${saga.id},
        ${saga.orderId},
        ${saga.type},
        ${saga.status},
        ${saga.currentStep},
        ${saga.startedAt},
        ${saga.completedAt},
        ${toJson(saga.metadata)}::jsonb
      )
    `;
  }

  async update(saga: SagaInstance): Promise<void> {
    const sql = getSql();
    await sql`
      UPDATE saga_instances
      SET status       = ${saga.status},
          current_step = ${saga.currentStep},
          completed_at = ${saga.completedAt},
          metadata     = ${toJson(saga.metadata)}::jsonb
      WHERE id = ${saga.id}
    `;
  }

  async createStep(step: SagaStep): Promise<void> {
    const sql = getSql();
    await sql`
      INSERT INTO saga_steps (
        id, saga_id, step_name, step_order, status,
        input_payload, output_payload, error_message,
        started_at, completed_at,
        compensation_status, compensation_error
      ) VALUES (
        ${step.id},
        ${step.sagaId},
        ${step.stepName},
        ${step.stepOrder},
        ${step.status},
        ${toJson(step.inputPayload)}::jsonb,
        ${toJson(step.outputPayload)}::jsonb,
        ${step.errorMessage},
        ${step.startedAt},
        ${step.completedAt},
        ${step.compensationStatus},
        ${step.compensationError}
      )
    `;
  }

  async updateStep(step: SagaStep): Promise<void> {
    const sql = getSql();
    await sql`
      UPDATE saga_steps
      SET status              = ${step.status},
          output_payload      = ${toJson(step.outputPayload)}::jsonb,
          error_message       = ${step.errorMessage},
          completed_at        = ${step.completedAt},
          compensation_status = ${step.compensationStatus},
          compensation_error  = ${step.compensationError}
      WHERE id = ${step.id}
    `;
  }

  async getSteps(sagaId: string): Promise<SagaStep[]> {
    const sql = getSql();
    const rows = await sql<SagaStepRow[]>`
      SELECT * FROM saga_steps
      WHERE saga_id = ${sagaId}
      ORDER BY step_order ASC
    `;
    return rows.map((r) => this.toDomainStep(r));
  }

  private toDomainSaga(row: SagaRow): SagaInstance {
    return {
      id: row.id,
      orderId: row.order_id,
      type: row.type,
      status: row.status,
      currentStep: row.current_step,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
  }

  private toDomainStep(row: SagaStepRow): SagaStep {
    return {
      id: row.id,
      sagaId: row.saga_id,
      stepName: row.step_name,
      stepOrder: row.step_order,
      status: row.status as StepStatus,
      inputPayload: row.input_payload,
      outputPayload: row.output_payload,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      compensationStatus: row.compensation_status as CompensationStatus,
      compensationError: row.compensation_error,
    };
  }
}
