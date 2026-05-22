import { Decimal } from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Immutable Money value object.
 *
 * Uses decimal.js internally to avoid IEEE 754 floating-point errors.
 * All arithmetic produces exact decimal results (e.g. 0.1 + 0.2 === "0.30").
 * Amount is always stored as a two-decimal-place string: "29.99".
 *
 * Import note: `import { Decimal } from 'decimal.js'` is the correct ESM form
 * for decimal.js ≥ 10.x in a project with "type": "module".
 */
export class Money {
  readonly amount: string;
  readonly currency: string;

  constructor(amount: string | number, currency: string) {
    if (!currency || currency.length !== 3) {
      throw new Error(`Invalid currency code: ${String(currency)}`);
    }
    const d = new Decimal(String(amount));
    if (d.isNaN() || !d.isFinite()) {
      throw new Error(`Invalid monetary amount: ${String(amount)}`);
    }
    if (d.isNegative()) {
      throw new Error(`Monetary amount cannot be negative: ${String(amount)}`);
    }
    this.amount = d.toFixed(2);
    this.currency = currency.toUpperCase();
  }

  static zero(currency: string): Money {
    return new Money('0.00', currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    const result = new Decimal(this.amount).plus(new Decimal(other.amount));
    return new Money(result.toFixed(2), this.currency);
  }

  multiply(factor: number): Money {
    if (!Number.isFinite(factor) || factor < 0) {
      throw new Error(`Invalid multiplication factor: ${factor}`);
    }
    const result = new Decimal(this.amount).times(new Decimal(String(factor)));
    return new Money(result.toFixed(2), this.currency);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return new Decimal(this.amount).greaterThan(new Decimal(other.amount));
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.amount, currency: this.currency };
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Cannot operate on money with different currencies: ${this.currency} and ${other.currency}`,
      );
    }
  }
}
