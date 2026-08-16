import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { ArenaConfig, ContestantResult, ValidationResult } from './models.ts'

export class ArenaCapabilityError extends Error {
  constructor(capability: string) {
    super(`ARENA_ADAPTER_UNAVAILABLE: ${capability}`)
    this.name = 'ArenaCapabilityError'
  }
}

export interface CommandResult {
  code: number
  output: string
  durationMs: number
  truncated: boolean
}

export interface ArenaExecutor {
  assertClean(repo: string): Promise<void>
  createWorktree(repo: string, matchId: string, contestantId: string): Promise<string>
  runContestant(result: ContestantResult, objective: string, signal: AbortSignal): Promise<void>
  validate(worktree: string, config: ArenaConfig, signal: AbortSignal): Promise<ValidationResult[]>
  diff(worktree: string): Promise<{ diff: string; changedFiles: string[] }>
  checkpoint(repo: string): Promise<string>
  apply(repo: string, worktree: string): Promise<void>
  cleanup(worktree: string, repository?: string): Promise<void>
}

function validationArgv(command: string): string[] {
  if (/['"`;&|<>$\r\n]/u.test(command)) throw new Error(`Validation command contains unsupported shell syntax: ${command}`)
  const argv = command.trim().split(/\s+/u)
  if (argv.length === 0 || argv[0] === undefined) throw new Error('Validation command is empty.')
  return argv
}

export class DshAgentRunner {
  constructor(private readonly agents: AgentRegistry) {}

  async run(result: ContestantResult, objective: string, signal: AbortSignal): Promise<void> {
    const handle = await this.agents.create({
      sessionId: SessionId(`arena-${randomUUID()}`),
      meta: { cwd: result.worktree, origin: 'subagent' },
      agentOptions: { provider: result.contestant.provider, model: result.contestant.model },
      signal,
    })
    try {
      await handle.agent.whenIdle()
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: objective }],
        source: { kind: 'plugin', plugin: 'dsh-agent-arena' },
      }))
      await handle.agent.whenIdle()
      if (signal.aborted) throw signal.reason
    } finally {
      await handle.dispose()
    }
  }
}

/** Git isolation and deterministic validation over DSH-managed process trees. */
export class GitWorktreeExecutor implements ArenaExecutor {
  private readonly repositories = new Map<string, string>()

  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly runner: DshAgentRunner,
    private readonly worktreeRoot = resolve(tmpdir(), 'dsh-agent-arena'),
  ) {}

  async assertClean(repo: string): Promise<void> {
    const repository = resolve(repo)
    const result = await this.run(repository, ['git', 'status', '--porcelain=v1'], undefined, 30_000)
    if (result.code !== 0) throw new Error(`Git status failed: ${result.output}`)
    if (result.output.trim().length > 0) throw new Error('Repository must be clean before an Arena match.')
  }

  async createWorktree(repo: string, matchId: string, contestantId: string): Promise<string> {
    const repository = resolve(repo)
    const parent = resolve(this.worktreeRoot, matchId)
    const worktree = resolve(parent, contestantId)
    const destination = relative(parent, worktree)
    if (destination.startsWith('..') || isAbsolute(destination)) throw new Error('Invalid worktree destination.')
    await mkdir(parent, { recursive: true })
    const result = await this.run(repository, ['git', 'worktree', 'add', '--detach', worktree, 'HEAD'], undefined, 60_000)
    if (result.code !== 0) throw new Error(`Worktree create failed: ${result.output}`)
    this.repositories.set(worktree, repository)
    return worktree
  }

  async runContestant(result: ContestantResult, objective: string, signal: AbortSignal): Promise<void> {
    await this.runner.run(result, objective, signal)
  }

  async validate(worktree: string, config: ArenaConfig, signal: AbortSignal): Promise<ValidationResult[]> {
    const results: ValidationResult[] = []
    for (const item of config.validation) {
      const result = await this.run(worktree, validationArgv(item.command), signal, item.timeoutMs)
      results.push({ command: item.command, exitCode: result.code, durationMs: result.durationMs, output: result.output, weight: item.weight })
    }
    return results
  }

  async diff(worktree: string): Promise<{ diff: string; changedFiles: string[] }> {
    const intent = await this.run(worktree, ['git', 'add', '-N', '--', '.'], undefined, 60_000)
    if (intent.code !== 0) throw new Error(`Could not stage intent-to-add entries: ${intent.output}`)
    const patch = await this.run(worktree, ['git', 'diff', 'HEAD', '--no-ext-diff', '--binary'], undefined, 60_000, undefined, 1_000_000)
    const names = await this.run(worktree, ['git', 'diff', 'HEAD', '--name-only'], undefined, 60_000)
    if (patch.code !== 0 || names.code !== 0) throw new Error('Could not collect Git diff.')
    if (patch.truncated) throw new Error('Contestant patch exceeds the 1 MB Arena review limit.')
    if (names.truncated) throw new Error('Changed-file list exceeds the Arena output limit.')
    return { diff: patch.output, changedFiles: names.output.trim().length === 0 ? [] : names.output.trim().split(/\r?\n/u) }
  }

  async checkpoint(repo: string): Promise<string> {
    const result = await this.run(resolve(repo), ['git', 'rev-parse', 'HEAD'], undefined, 30_000)
    if (result.code !== 0) throw new Error(result.output)
    return result.output.trim()
  }

  async apply(repo: string, worktree: string): Promise<void> {
    const patch = await this.run(worktree, ['git', 'diff', 'HEAD', '--binary'], undefined, 60_000, undefined, 1_000_000)
    if (patch.code !== 0) throw new Error(patch.output)
    if (patch.truncated) throw new Error('Winner patch exceeds the 1 MB Arena apply limit.')
    if (patch.output.length === 0) throw new Error('Winner produced no Git diff.')
    const check = await this.run(resolve(repo), ['git', 'apply', '--check', '--whitespace=error', '-'], undefined, 60_000, patch.output)
    if (check.code !== 0) throw new Error(`Winner patch check failed: ${check.output}`)
    const applied = await this.run(resolve(repo), ['git', 'apply', '--index', '--whitespace=error', '-'], undefined, 60_000, patch.output)
    if (applied.code !== 0) throw new Error(`Winner apply failed: ${applied.output}`)
  }

  async cleanup(worktree: string, repository?: string): Promise<void> {
    const owner = this.repositories.get(worktree) ?? (repository === undefined ? undefined : resolve(repository))
    if (owner !== undefined) {
      await this.run(owner, ['git', 'worktree', 'remove', '--force', worktree], undefined, 60_000).catch(() => undefined)
      this.repositories.delete(worktree)
    }
    await rm(worktree, { recursive: true, force: true })
  }

  private async run(cwd: string, argv: string[], signal: AbortSignal | undefined, timeoutMs: number, stdin?: string, outputLimit = 80_000): Promise<CommandResult> {
    const started = Date.now()
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const child = this.subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: stdin === undefined ? 'ignore' : { data: stdin },
        stdout: { maxBytes: outputLimit },
        stderr: { maxBytes: outputLimit },
      },
      graceMs: 2_000,
      signal: combined,
    })
    const outcome = await child.done
    const stdout = child.collected.stdout?.readFrom(0)
    const stderr = child.collected.stderr?.readFrom(0)
    if (timeout.aborted && !signal?.aborted) throw new Error(`Command timed out after ${timeoutMs} ms: ${argv[0]}`)
    if (signal?.aborted) throw signal.reason
    const truncated = stdout?.lossy === true || stderr?.lossy === true
    const output = `${stdout?.text ?? ''}${stderr?.text ?? ''}`.slice(-outputLimit)
    return { code: outcome.exitCode ?? -1, output, durationMs: Date.now() - started, truncated }
  }
}

export function worktreeLabel(path: string): string {
  return basename(path)
}
