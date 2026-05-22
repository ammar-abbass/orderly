/**
 * Re-export PaymentGateway and PaymentResult from the domain ports.
 *
 * The canonical interfaces live in src/domain/ports/payment-gateway.ts.
 * This file exists for backward compatibility with infrastructure code
 * that already imports from this path.
 */
export type { PaymentGateway, PaymentResult } from '../../domain/ports/payment-gateway.js';
