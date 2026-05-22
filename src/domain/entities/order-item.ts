import { Money } from '../value-objects/money.js';
import { SKU } from '../value-objects/sku.js';

/**
 * OrderItem — line item within an Order aggregate.
 * Fully immutable: all fields are readonly.
 */
export interface OrderItem {
  readonly id: string;
  readonly orderId: string;
  readonly sku: SKU;
  readonly quantity: number;
  readonly unitPrice: Money;
}

export function createOrderItem(
  id: string,
  orderId: string,
  sku: string,
  quantity: number,
  unitPrice: string,
  currency: string,
): OrderItem {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`OrderItem quantity must be a positive integer, got: ${quantity}`);
  }
  return {
    id,
    orderId,
    sku: new SKU(sku),
    quantity,
    unitPrice: new Money(unitPrice, currency),
  };
}
