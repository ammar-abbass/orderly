/**
 * SKU (Stock Keeping Unit) value object.
 * Alphanumeric, hyphens and underscores, 1–64 characters.
 */
export class SKU {
  private static readonly VALID = /^[A-Za-z0-9\-_]+$/;

  readonly value: string;

  constructor(value: string) {
    if (!value || value.length > 64) {
      throw new Error('SKU must be between 1 and 64 characters');
    }
    if (!SKU.VALID.test(value)) {
      throw new Error('SKU must be alphanumeric with hyphens and underscores only');
    }
    this.value = value;
  }

  equals(other: SKU): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
