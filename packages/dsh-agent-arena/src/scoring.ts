import type { ContestantResult } from './models.ts'
/** Deterministic weighted pass rate, rounded to one decimal place. */
export function scoreContestant(result: ContestantResult) { const total = result.validations.reduce((sum, item) => sum + item.weight, 0); const passed = result.validations.filter(item => item.exitCode === 0).reduce((sum, item) => sum + item.weight, 0); return total === 0 ? 0 : Math.round((passed / total) * 1000) / 10 }
