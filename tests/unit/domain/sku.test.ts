import { describe, it, expect } from 'vitest';
import { SKU } from '../../../src/domain/value-objects/sku.js';

describe('SKU', () => {
  it('accepts valid alphanumeric SKU', () => {
    expect(new SKU('PROD-001').value).toBe('PROD-001');
  });

  it('accepts underscores', () => {
    expect(new SKU('PROD_001').value).toBe('PROD_001');
  });

  it('accepts single character', () => {
    expect(new SKU('A').value).toBe('A');
  });

  it('rejects empty string', () => {
    expect(() => new SKU('')).toThrow('1 and 64 characters');
  });

  it('rejects SKU longer than 64 characters', () => {
    expect(() => new SKU('A'.repeat(65))).toThrow('1 and 64 characters');
  });

  it('rejects spaces', () => {
    expect(() => new SKU('PROD 001')).toThrow('alphanumeric');
  });

  it('rejects special characters', () => {
    expect(() => new SKU('PROD@001')).toThrow('alphanumeric');
  });

  it('equals returns true for same value', () => {
    expect(new SKU('PROD-001').equals(new SKU('PROD-001'))).toBe(true);
  });

  it('equals returns false for different value', () => {
    expect(new SKU('PROD-001').equals(new SKU('PROD-002'))).toBe(false);
  });

  it('toString returns the raw value', () => {
    expect(new SKU('PROD-001').toString()).toBe('PROD-001');
  });
});
