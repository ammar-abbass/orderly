import { describe, it, expect } from 'vitest';
import {
  createOrder,
  transitionOrder,
  canTransitionTo,
  type OrderStatus,
} from '../../../src/domain/entities/order.js';
import { createOrderItem } from '../../../src/domain/entities/order-item.js';
import { v4 as uuidv4 } from 'uuid';

function makeItem(sku = 'SKU-001', quantity = 2, price = '10.00', currency = 'USD') {
  return createOrderItem(uuidv4(), uuidv4(), sku, quantity, price, currency);
}

describe('Order entity', () => {
  describe('createOrder', () => {
    it('creates a PENDING order with correct total', () => {
      const items = [makeItem('A', 2, '10.00'), makeItem('B', 1, '5.00')];
      const order = createOrder(uuidv4(), 'cust-1', items, 'USD', 'idem-key');

      expect(order.status).toBe('PENDING');
      // total = 2*10.00 + 1*5.00 = 25.00
      expect(order.totalAmount.amount).toBe('25.00');
      expect(order.idempotencyKey).toBe('idem-key');
    });

    it('total is exact decimal (no float drift)', () => {
      const items = [makeItem('A', 1, '0.10'), makeItem('B', 1, '0.20')];
      const order = createOrder(uuidv4(), 'cust-1', items, 'USD');
      expect(order.totalAmount.amount).toBe('0.30');
    });

    it('throws when items array is empty', () => {
      expect(() => createOrder(uuidv4(), 'cust-1', [], 'USD')).toThrow(
        'at least one item',
      );
    });

    it('sets createdAt and updatedAt', () => {
      const order = createOrder(uuidv4(), 'cust-1', [makeItem()], 'USD');
      expect(order.createdAt).toBeInstanceOf(Date);
      expect(order.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('state transitions', () => {
    const validPaths: Array<[OrderStatus, OrderStatus]> = [
      ['PENDING', 'PAID'],
      ['PENDING', 'CANCELLED'],
      ['PENDING', 'COMPENSATING'],
      ['PAID', 'FULFILLED'],
      ['PAID', 'COMPENSATING'],
      ['FULFILLED', 'SHIPPED'],
      ['COMPENSATING', 'CANCELLED'],
    ];

    for (const [from, to] of validPaths) {
      it(`allows ${from} → ${to}`, () => {
        const items = [makeItem()];
        let order = createOrder(uuidv4(), 'cust-1', items, 'USD');

        // Manually set status for test
        order = { ...order, status: from };
        expect(() => transitionOrder(order, to)).not.toThrow();
      });
    }

    const invalidPaths: Array<[OrderStatus, OrderStatus]> = [
      ['CANCELLED', 'PENDING'],
      ['CANCELLED', 'PAID'],
      ['SHIPPED', 'PENDING'],
      ['PAID', 'PENDING'],
    ];

    for (const [from, to] of invalidPaths) {
      it(`rejects ${from} → ${to}`, () => {
        const items = [makeItem()];
        let order = createOrder(uuidv4(), 'cust-1', items, 'USD');
        order = { ...order, status: from };
        expect(() => transitionOrder(order, to)).toThrow('Invalid state transition');
      });
    }

    it('transitionOrder returns a new object (immutability)', () => {
      const order = createOrder(uuidv4(), 'cust-1', [makeItem()], 'USD');
      const paid = transitionOrder(order, 'PAID');
      expect(paid).not.toBe(order);
      expect(order.status).toBe('PENDING');
      expect(paid.status).toBe('PAID');
    });

    it('CANCELLED → any active state is impossible', () => {
      let order = createOrder(uuidv4(), 'cust-1', [makeItem()], 'USD');
      order = { ...order, status: 'CANCELLED' };
      for (const status of ['PENDING', 'PAID', 'FULFILLED', 'SHIPPED', 'COMPENSATING'] as OrderStatus[]) {
        expect(canTransitionTo(order, status)).toBe(false);
      }
    });
  });
});
