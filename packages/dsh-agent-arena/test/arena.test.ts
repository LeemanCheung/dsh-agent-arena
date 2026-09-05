import { describe, expect, it } from 'vitest'
import { ArenaConfigSchema, DEFAULT_VALIDATION_COMMANDS } from '../src/models.ts'
import { ArenaCapabilityError } from '../src/adapters.ts'
import { scoreContestant } from '../src/scoring.ts'

describe('arena validation and scoring', () => {
  it('requires 2–4 safe contestant identities', () => expect(() => ArenaConfigSchema.parse({ objective: 'x', repository: 'C:/repo', contestants: [{ id: '../escape', label: 'x', provider: 'p', model: 'm' }], validation: [{ command: 'git status --porcelain=v1' }] })).toThrow())
  it('calculates weighted objective score', () => expect(scoreContestant({ contestant: { id: 'a', label: 'A', provider: 'p', model: 'm' }, worktree: '', status: 'completed', diff: '', changedFiles: [], validations: [{ command: 'x', exitCode: 0, durationMs: 1, output: '', weight: 3 }, { command: 'y', exitCode: 1, durationMs: 1, output: '', weight: 1 }], score: 0 })).toBe(75))
  it('does not award a default 100 score before project checks are configured', () => {
    expect(DEFAULT_VALIDATION_COMMANDS).toEqual([])
    expect(scoreContestant({ contestant: { id: 'a', label: 'A', provider: 'p', model: 'm' }, worktree: '', status: 'completed', diff: '', changedFiles: [], validations: [], score: 0 })).toBe(0)
  })
  it('fails loud for private capability gaps', () => expect(() => { throw new ArenaCapabilityError('runner') }).toThrow('ARENA_ADAPTER_UNAVAILABLE'))
})
