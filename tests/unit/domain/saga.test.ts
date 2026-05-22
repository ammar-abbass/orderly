import { describe, it, expect } from 'vitest';
import {
  createSagaInstance,
  startSaga,
  completeSaga,
  failSaga,
  startCompensation,
  completeCompensation,
  createStep,
  completeStep,
  failStep,
  markStepCompensated,
  markStepCompensationFailed,
} from '../../../src/domain/entities/saga.js';
import { v4 as uuidv4 } from 'uuid';

describe('SagaInstance transitions', () => {
  it('starts in PENDING', () => {
    const saga = createSagaInstance(uuidv4(), uuidv4());
    expect(saga.status).toBe('PENDING');
    expect(saga.completedAt).toBeNull();
  });

  it('PENDING → RUNNING via startSaga', () => {
    const saga = startSaga(createSagaInstance(uuidv4(), uuidv4()));
    expect(saga.status).toBe('RUNNING');
  });

  it('RUNNING → COMPLETED via completeSaga', () => {
    const saga = completeSaga(startSaga(createSagaInstance(uuidv4(), uuidv4())));
    expect(saga.status).toBe('COMPLETED');
    expect(saga.completedAt).toBeInstanceOf(Date);
  });

  it('RUNNING → COMPENSATING via startCompensation', () => {
    const saga = startCompensation(startSaga(createSagaInstance(uuidv4(), uuidv4())));
    expect(saga.status).toBe('COMPENSATING');
  });

  it('COMPENSATING → FAILED via completeCompensation', () => {
    const saga = completeCompensation(
      startCompensation(startSaga(createSagaInstance(uuidv4(), uuidv4()))),
    );
    expect(saga.status).toBe('FAILED');
    expect(saga.completedAt).toBeInstanceOf(Date);
  });

  it('RUNNING → FAILED via failSaga', () => {
    const saga = failSaga(startSaga(createSagaInstance(uuidv4(), uuidv4())));
    expect(saga.status).toBe('FAILED');
  });

  it('all transitions return new objects (immutability)', () => {
    const original = createSagaInstance(uuidv4(), uuidv4());
    const running = startSaga(original);
    expect(running).not.toBe(original);
    expect(original.status).toBe('PENDING');
  });

  it('cannot start an already-running saga', () => {
    const running = startSaga(createSagaInstance(uuidv4(), uuidv4()));
    expect(() => startSaga(running)).toThrow('Cannot start saga in status RUNNING');
  });

  it('cannot complete a PENDING saga', () => {
    expect(() => completeSaga(createSagaInstance(uuidv4(), uuidv4()))).toThrow();
  });

  it('CANCELLED status never reached from COMPLETED', () => {
    // COMPLETED is a terminal state — no further transitions
    const completed = completeSaga(startSaga(createSagaInstance(uuidv4(), uuidv4())));
    expect(() => failSaga(completed)).toThrow();
    expect(() => startCompensation(completed)).toThrow();
  });
});

describe('SagaStep transitions', () => {
  function makeStep() {
    return createStep(uuidv4(), uuidv4(), 'RESERVE_INVENTORY', 0, { items: [] });
  }

  it('new step has RUNNING status', () => {
    const step = makeStep();
    expect(step.status).toBe('RUNNING');
    expect(step.startedAt).toBeInstanceOf(Date);
    expect(step.completedAt).toBeNull();
    expect(step.outputPayload).toBeNull();
  });

  it('completeStep produces COMPLETED with output', () => {
    const done = completeStep(makeStep(), { reserved: true });
    expect(done.status).toBe('COMPLETED');
    expect(done.outputPayload).toEqual({ reserved: true });
    expect(done.completedAt).toBeInstanceOf(Date);
  });

  it('failStep produces FAILED with error message', () => {
    const failed = failStep(makeStep(), 'Insufficient stock');
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toBe('Insufficient stock');
  });

  it('markStepCompensated sets compensationStatus to COMPLETED', () => {
    const compensated = markStepCompensated(completeStep(makeStep(), {}));
    expect(compensated.compensationStatus).toBe('COMPLETED');
  });

  it('markStepCompensationFailed sets compensationStatus to FAILED', () => {
    const failed = markStepCompensationFailed(makeStep(), 'refund failed');
    expect(failed.compensationStatus).toBe('FAILED');
    expect(failed.compensationError).toBe('refund failed');
  });

  it('all transitions return new objects — original is never mutated', () => {
    const original = makeStep();
    const completed = completeStep(original, { ok: true });
    expect(completed).not.toBe(original);
    expect(original.status).toBe('RUNNING');
    expect(original.outputPayload).toBeNull();
  });
});
