export type SagaStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPENSATING' | 'FAILED';
export type StepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type CompensationStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/**
 * SagaStep — a single step within a distributed transaction.
 * All fields are readonly. Use the pure transition helpers to produce new values.
 */
export interface SagaStep {
  readonly id: string;
  readonly sagaId: string;
  readonly stepName: string;
  readonly stepOrder: number;
  readonly status: StepStatus;
  readonly inputPayload: unknown;
  readonly outputPayload: unknown | null;
  readonly errorMessage: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly compensationStatus: CompensationStatus;
  readonly compensationError: string | null;
}

/**
 * SagaInstance — orchestration state of a distributed transaction.
 * All fields are readonly. Use the pure transition helpers to produce new values.
 */
export interface SagaInstance {
  readonly id: string;
  readonly orderId: string;
  readonly type: string;
  readonly status: SagaStatus;
  readonly currentStep: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ─── SagaInstance transitions ──────────────────────────────────────────────

export function createSagaInstance(
  id: string,
  orderId: string,
  type = 'ORDER_FULFILLMENT',
): SagaInstance {
  return {
    id,
    orderId,
    type,
    status: 'PENDING',
    currentStep: 0,
    startedAt: new Date(),
    completedAt: null,
    metadata: {},
  };
}

export function startSaga(saga: SagaInstance): SagaInstance {
  if (saga.status !== 'PENDING') {
    throw new Error(`Cannot start saga in status ${saga.status}`);
  }
  return { ...saga, status: 'RUNNING' };
}

export function completeSaga(saga: SagaInstance): SagaInstance {
  if (saga.status !== 'RUNNING') {
    throw new Error(`Cannot complete saga in status ${saga.status}`);
  }
  return { ...saga, status: 'COMPLETED', completedAt: new Date() };
}

export function failSaga(saga: SagaInstance): SagaInstance {
  if (saga.status !== 'RUNNING' && saga.status !== 'COMPENSATING') {
    throw new Error(`Cannot fail saga in status ${saga.status}`);
  }
  return { ...saga, status: 'FAILED', completedAt: new Date() };
}

export function startCompensation(saga: SagaInstance): SagaInstance {
  if (saga.status !== 'RUNNING') {
    throw new Error(`Cannot compensate saga in status ${saga.status}`);
  }
  return { ...saga, status: 'COMPENSATING' };
}

export function completeCompensation(saga: SagaInstance): SagaInstance {
  if (saga.status !== 'COMPENSATING') {
    throw new Error(`Cannot complete compensation in status ${saga.status}`);
  }
  return { ...saga, status: 'FAILED', completedAt: new Date() };
}

// ─── SagaStep transitions (pure — return new objects) ──────────────────────

export function createStep(
  id: string,
  sagaId: string,
  stepName: string,
  stepOrder: number,
  inputPayload: unknown,
): SagaStep {
  return {
    id,
    sagaId,
    stepName,
    stepOrder,
    status: 'RUNNING',
    inputPayload,
    outputPayload: null,
    errorMessage: null,
    startedAt: new Date(),
    completedAt: null,
    compensationStatus: 'PENDING',
    compensationError: null,
  };
}

export function completeStep(step: SagaStep, output: unknown): SagaStep {
  return { ...step, status: 'COMPLETED', outputPayload: output, completedAt: new Date() };
}

export function failStep(step: SagaStep, error: string): SagaStep {
  return { ...step, status: 'FAILED', errorMessage: error, completedAt: new Date() };
}

export function markStepCompensated(step: SagaStep): SagaStep {
  return { ...step, compensationStatus: 'COMPLETED' };
}

export function markStepCompensationFailed(step: SagaStep, error: string): SagaStep {
  return { ...step, compensationStatus: 'FAILED', compensationError: error };
}
