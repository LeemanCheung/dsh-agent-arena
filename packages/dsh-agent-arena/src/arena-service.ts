import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { type ArenaExecutor, ArenaCapabilityError } from './adapters.ts'
import { ArenaConfigSchema, type ArenaConfig, type ArenaEvent, type ArenaMatch, type ContestantResult } from './models.ts'
import { scoreContestant } from './scoring.ts'
import { canCancel } from './state.ts'

export interface ArenaStore {
  load(): Promise<ArenaMatch[]>
  save(matches: ArenaMatch[]): Promise<void>
}

export class MemoryArenaStore implements ArenaStore {
  private value: ArenaMatch[] = []

  async load(): Promise<ArenaMatch[]> {
    return structuredClone(this.value)
  }

  async save(matches: ArenaMatch[]): Promise<void> {
    this.value = structuredClone(matches)
  }
}

function now(): string {
  return new Date().toISOString()
}

function appendEvent(match: ArenaMatch, type: string, message: string, contestantId?: string): void {
  const item: ArenaEvent = { at: now(), type, message, ...(contestantId === undefined ? {} : { contestantId }) }
  match.events.push(item)
  match.updatedAt = item.at
}

export interface ArenaServiceOptions {
  executor: ArenaExecutor
  store?: ArenaStore
}

export class ArenaService extends TypertRemoteService {
  private readonly executor: ArenaExecutor
  private readonly store: ArenaStore
  private readonly matches = new Map<string, ArenaMatch>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly runs = new Map<string, Promise<void>>()

  constructor(ctx: Context, options: ArenaServiceOptions) {
    super(ctx, 'agentArena')
    this.executor = options.executor
    this.store = options.store ?? new MemoryArenaStore()
  }

  async hydrate(): Promise<void> {
    let changed = false
    for (const match of await this.store.load()) {
      if (match.status === 'queued' || canCancel(match.status)) {
        match.status = 'failed'
        match.error = 'Arena Host restarted before this match completed.'
        appendEvent(match, 'failed', match.error)
        for (const result of match.contestants) {
          if (result.worktree.length === 0) continue
          await this.executor.cleanup(result.worktree, match.config.repository).catch(error => {
            appendEvent(match, 'cleanup-failed', error instanceof Error ? error.message : String(error), result.contestant.id)
          })
          result.worktree = ''
        }
        changed = true
      }
      this.matches.set(match.id, match)
    }
    if (changed) await this.persist()
  }

  @Remote('list')
  async list(limit: number): Promise<ArenaMatch[]> {
    const bounded = Math.max(1, Math.min(100, limit))
    return [...this.matches.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, bounded)
      .map(match => structuredClone(match))
  }

  @Remote('get')
  async get(id: string): Promise<ArenaMatch> {
    const match = this.matches.get(id)
    if (match === undefined) throw new Error(`Arena match not found: ${id}`)
    return structuredClone(match)
  }

  @Remote('start')
  async start(input: ArenaConfig): Promise<ArenaMatch> {
    const config = ArenaConfigSchema.parse(input)
    const id = randomUUID()
    const createdAt = now()
    const contestants: ContestantResult[] = config.contestants.map(contestant => ({
      contestant,
      worktree: '',
      status: 'pending',
      diff: '',
      changedFiles: [],
      validations: [],
      score: 0,
    }))
    const match: ArenaMatch = {
      id,
      config,
      status: 'queued',
      createdAt,
      updatedAt: createdAt,
      events: [],
      contestants,
    }
    this.matches.set(id, match)
    await this.persist()
    const running = this.run(match)
    this.runs.set(match.id, running)
    void running.then(() => { this.runs.delete(match.id) }, () => { this.runs.delete(match.id) })
    return structuredClone(match)
  }

  async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort('Arena service is stopping.')
    await Promise.allSettled(this.runs.values())
  }

  @Remote('cancel')
  async cancel(id: string): Promise<ArenaMatch> {
    const match = this.requireMatch(id)
    const controller = this.controllers.get(id)
    if (controller !== undefined && canCancel(match.status)) {
      controller.abort()
      appendEvent(match, 'cancel-requested', 'Cancellation requested.')
      await this.persist()
    }
    return structuredClone(match)
  }

  @Remote('applyWinner')
  async applyWinner(id: string): Promise<ArenaMatch> {
    const match = this.requireMatch(id)
    if (match.status !== 'completed' || match.winnerId === undefined) {
      throw new Error('Only a completed match with a winner can be applied.')
    }
    const winner = match.contestants.find(item => item.contestant.id === match.winnerId)
    if (winner === undefined) throw new Error('Winner record is unavailable.')
    await this.executor.assertClean(match.config.repository)
    const currentRevision = await this.executor.checkpoint(match.config.repository)
    if (match.baseRevision === undefined || currentRevision !== match.baseRevision) {
      throw new Error('Repository HEAD changed after this match started; rerun the match before applying a winner.')
    }
    await this.executor.apply(match.config.repository, winner.worktree)
    match.appliedRevision = currentRevision
    appendEvent(match, 'winner-applied', `Applied ${winner.contestant.label} at checkpoint ${currentRevision}.`, winner.contestant.id)
    if (!match.config.keepWorktrees) {
      await this.executor.cleanup(winner.worktree, match.config.repository)
      winner.worktree = ''
    }
    await this.persist()
    return structuredClone(match)
  }

  private requireMatch(id: string): ArenaMatch {
    const match = this.matches.get(id)
    if (match === undefined) throw new Error(`Arena match not found: ${id}`)
    return match
  }

  private async persist(): Promise<void> {
    await this.store.save([...this.matches.values()])
  }

  private async run(match: ArenaMatch): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(match.id, controller)
    try {
      match.status = 'preparing'
      appendEvent(match, 'preparing', 'Checking clean Git repository.')
      await this.executor.assertClean(match.config.repository)
      match.baseRevision = await this.executor.checkpoint(match.config.repository)
      for (const result of match.contestants) {
        result.worktree = await this.executor.createWorktree(match.config.repository, match.id, result.contestant.id)
        appendEvent(match, 'worktree-ready', 'Created isolated worktree.', result.contestant.id)
      }
      await this.persist()
      match.status = 'running'
      await Promise.all(match.contestants.map(result => this.runContestant(match, result, controller.signal)))
      if (controller.signal.aborted) {
        match.status = 'cancelled'
        appendEvent(match, 'cancelled', 'All contestants were stopped.')
        return
      }
      match.status = 'scoring'
      const candidates = match.contestants
        .filter(item => item.status === 'completed')
        .sort((left, right) => right.score - left.score || left.contestant.id.localeCompare(right.contestant.id))
      if (candidates[0] === undefined) delete match.winnerId
      else match.winnerId = candidates[0].contestant.id
      match.status = candidates.length === 0 ? 'failed' : 'completed'
      appendEvent(match, match.status, candidates.length === 0 ? 'No contestant completed successfully.' : 'Deterministic scoring completed.')
    } catch (error) {
      match.status = controller.signal.aborted ? 'cancelled' : 'failed'
      match.error = error instanceof Error ? error.message : String(error)
      appendEvent(match, match.status, match.error)
    } finally {
      this.controllers.delete(match.id)
      await this.persist()
      if (!match.config.keepWorktrees) {
        const retainedWinner = match.status === 'completed' && match.appliedRevision === undefined ? match.winnerId : undefined
        await Promise.all(match.contestants
          .filter(result => result.worktree.length > 0 && result.contestant.id !== retainedWinner)
          .map(async result => {
            await this.executor.cleanup(result.worktree, match.config.repository).catch(() => undefined)
            result.worktree = ''
          }))
        await this.persist()
      }
    }
  }

  private async runContestant(match: ArenaMatch, result: ContestantResult, signal: AbortSignal): Promise<void> {
    result.status = 'running'
    appendEvent(match, 'contestant-started', `${result.contestant.label} started.`, result.contestant.id)
    try {
      await this.executor.runContestant(result, match.config.objective, signal)
      if (signal.aborted) {
        result.status = 'cancelled'
        return
      }
      match.status = 'validating'
      result.validations = await this.executor.validate(result.worktree, match.config, signal)
      const diff = await this.executor.diff(result.worktree)
      result.diff = diff.diff
      result.changedFiles = diff.changedFiles
      result.score = scoreContestant(result)
      result.status = 'completed'
      appendEvent(match, 'contestant-finished', `${result.contestant.label} scored ${result.score}.`, result.contestant.id)
    } catch (error) {
      result.status = signal.aborted ? 'cancelled' : 'failed'
      result.error = error instanceof Error ? error.message : String(error)
      appendEvent(match, 'contestant-failed', result.error, result.contestant.id)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentArena: ArenaService
  }
}

export { ArenaCapabilityError, scoreContestant }
