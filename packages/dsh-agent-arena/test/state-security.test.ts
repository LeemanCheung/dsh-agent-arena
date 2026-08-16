import { describe, expect, it } from 'vitest'
import { ArenaConfigSchema } from '../src/models.ts'
import { canCancel, isTerminal } from '../src/state.ts'

describe('arena state machine', () => {
  it('only permits cancellation while active', () => { expect(canCancel('queued')).toBe(false); expect(canCancel('running')).toBe(true); expect(canCancel('completed')).toBe(false) })
  it('recognizes every terminal outcome', () => { expect(isTerminal('completed')).toBe(true); expect(isTerminal('cancelled')).toBe(true); expect(isTerminal('failed')).toBe(true); expect(isTerminal('scoring')).toBe(false) })
})
describe('arena input security', () => {
  const base = { objective: 'implement safely', repository: 'C:/repo', contestants: [{ id: 'one', label: 'One', provider: 'p', model: 'm' }, { id: 'two', label: 'Two', provider: 'p', model: 'm' }], validation: [{ command: 'git status --porcelain=v1' }] }
  it('rejects traversal-like contestant ids', () => expect(() => ArenaConfigSchema.parse({ ...base, contestants: [{ ...base.contestants[0], id: '../one' }, base.contestants[1]] })).toThrow())
  it('caps untrusted objective and validation sizes', () => expect(() => ArenaConfigSchema.parse({ ...base, objective: 'x'.repeat(12_001) })).toThrow())
})
