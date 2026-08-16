import type { ArenaStatus } from './models.ts'
export function isTerminal(status: ArenaStatus) { return status === 'completed' || status === 'cancelled' || status === 'failed' }
export function canCancel(status: ArenaStatus) { return status === 'preparing' || status === 'running' || status === 'validating' || status === 'scoring' }
