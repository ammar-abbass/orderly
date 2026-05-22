import { v4 as uuidv4 } from 'uuid';

export function makeCreateOrderPayload(overrides?: {
  customerId?: string;
  sku?: string;
  quantity?: number;
  unitPrice?: string;
  paymentToken?: string;
  idempotencyKey?: string;
}) {
  return {
    customerId: overrides?.customerId ?? 'customer-test-001',
    items: [
      {
        sku: overrides?.sku ?? 'WIDGET-1',
        quantity: overrides?.quantity ?? 1,
        unitPrice: overrides?.unitPrice ?? '29.99',
      },
    ],
    currency: 'USD',
    paymentToken: overrides?.paymentToken ?? 'tok_test_visa',
    idempotencyKey: overrides?.idempotencyKey ?? uuidv4(),
  };
}

export const TEST_INVENTORY = [
  { sku: 'WIDGET-1',   quantity: 100 },
  { sku: 'WIDGET-2',   quantity: 50 },
  { sku: 'WIDGET-3',   quantity: 5 },
  { sku: 'WIDGET-RARE', quantity: 1 },
  { sku: 'WIDGET-OOS',  quantity: 0 },
];
