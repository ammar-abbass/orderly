/**
 * Re-export LockManager and LockRelease from the domain ports.
 *
 * The canonical interfaces live in src/domain/ports/lock-manager.ts.
 * This file exists for backward compatibility with infrastructure code
 * that already imports from this path.
 */
export type { LockManager, LockRelease } from '../../domain/ports/lock-manager.js';
