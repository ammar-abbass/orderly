import { describe, it, expect } from 'vitest';
import { Money } from '../../../src/domain/value-objects/money.js';

describe('Money', () => {
  describe('construction', () => {
    it('creates a valid Money instance', () => {
      const m = new Money('29.99', 'USD');
      expect(m.amount).toBe('29.99');
      expect(m.currency).toBe('USD');
    });

    it('normalises currency to uppercase', () => {
      const m = new Money('10.00', 'usd');
      expect(m.currency).toBe('USD');
    });

    it('normalises amount to two decimal places', () => {
      const m = new Money('10', 'USD');
      expect(m.amount).toBe('10.00');
    });

    it('rejects negative amounts', () => {
      expect(() => new Money('-1.00', 'USD')).toThrow('cannot be negative');
    });

    it('rejects NaN', () => {
      expect(() => new Money('abc', 'USD')).toThrow();
    });

    it('rejects invalid currency (wrong length)', () => {
      expect(() => new Money('10.00', 'US')).toThrow('Invalid currency code');
    });

    it('rejects empty currency', () => {
      expect(() => new Money('10.00', '')).toThrow('Invalid currency code');
    });

    it('creates zero', () => {
      const z = Money.zero('USD');
      expect(z.amount).toBe('0.00');
    });
  });

  describe('arithmetic precision', () => {
    it('avoids floating-point rounding errors: 0.1 + 0.2 === 0.30', () => {
      const a = new Money('0.10', 'USD');
      const b = new Money('0.20', 'USD');
      expect(a.add(b).amount).toBe('0.30');
    });

    it('adds two money values correctly', () => {
      const a = new Money('19.99', 'USD');
      const b = new Money('5.01', 'USD');
      expect(a.add(b).amount).toBe('25.00');
    });

    it('add is commutative', () => {
      const a = new Money('12.34', 'USD');
      const b = new Money('56.78', 'USD');
      expect(a.add(b).amount).toBe(b.add(a).amount);
    });

    it('multiplies correctly', () => {
      const m = new Money('9.99', 'USD');
      expect(m.multiply(3).amount).toBe('29.97');
    });

    it('multiply by 0 returns 0.00', () => {
      expect(new Money('99.99', 'USD').multiply(0).amount).toBe('0.00');
    });

    it('multiply rounds half-up', () => {
      // 0.005 rounds to 0.01 with ROUND_HALF_UP
      expect(new Money('0.01', 'USD').multiply(0.5).amount).toBe('0.01');
    });

    it('chained operations stay precise', () => {
      const base = new Money('10.00', 'USD');
      const result = base.multiply(3).add(new Money('0.01', 'USD'));
      expect(result.amount).toBe('30.01');
    });
  });

  describe('currency guards', () => {
    it('throws when adding different currencies', () => {
      expect(() => new Money('10.00', 'USD').add(new Money('10.00', 'EUR'))).toThrow(
        'different currencies',
      );
    });
  });

  describe('comparison', () => {
    it('isGreaterThan returns true when larger', () => {
      expect(new Money('10.00', 'USD').isGreaterThan(new Money('9.99', 'USD'))).toBe(true);
    });

    it('isGreaterThan returns false when equal', () => {
      expect(new Money('10.00', 'USD').isGreaterThan(new Money('10.00', 'USD'))).toBe(false);
    });

    it('equals matches same amount and currency', () => {
      expect(new Money('5.00', 'USD').equals(new Money('5.00', 'USD'))).toBe(true);
    });

    it('equals returns false for different currencies', () => {
      expect(new Money('5.00', 'USD').equals(new Money('5.00', 'EUR'))).toBe(false);
    });
  });

  describe('serialisation', () => {
    it('toJSON returns amount and currency', () => {
      expect(new Money('12.50', 'EUR').toJSON()).toEqual({ amount: '12.50', currency: 'EUR' });
    });

    it('toString includes currency', () => {
      expect(new Money('12.50', 'EUR').toString()).toBe('12.50 EUR');
    });
  });
});
