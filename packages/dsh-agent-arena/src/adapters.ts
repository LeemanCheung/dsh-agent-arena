import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
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
    const worktree = this.expectedWorktree(matchId, contestantId)
    const parent = resolve(worktree, '..')
    const realRoot = await this.ensureWorktreeRoot()
    try {
      const info = await lstat(parent)
      if (info.isSymbolicLink()) throw new Error('Arena match directory cannot be a symbolic link or junction.')
      this.assertRealContained(realRoot, await realpath(parent), 'Arena match directory escapes the worktree root.')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error
    }
    await mkdir(parent, { recursive: true })
    this.assertRealContained(realRoot, await realpath(parent), 'Arena match directory escapes the worktree root.')
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
    const target = await this.cleanupTarget(worktree)
    if (target === undefined) return
    const owner = this.repositories.get(target) ?? (repository === undefined ? undefined : resolve(repository))
    if (owner !== undefined) {
      await this.run(owner, ['git', 'worktree', 'remove', '--force', target], undefined, 60_000).catch(() => undefined)
      this.repositories.delete(target)
    }
    await rm(target, { recursive: true, force: true })
  }

  private async cleanupTarget(worktree: string): Promise<string | undefined> {
    const root = resolve(this.worktreeRoot)
    const target = resolve(worktree)
    const rel = relative(root, target)
    const parts = rel.split(sep)
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
      || parts.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(parts[0] ?? '') || !/^[a-z0-9][a-z0-9-]{0,31}$/u.test(parts[1] ?? '')) {
      throw new Error(`Refusing to clean a path outside the Arena worktree root: ${worktree}`)
    }
    let rootInfo
    try { rootInfo = await lstat(root) }
    catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (rootInfo.isSymbolicLink()) throw new Error('Refusing cleanup because the Arena worktree root is a symbolic link or junction.')
    try {
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw new Error(`Refusing to clean a symbolic-link worktree: ${worktree}`)
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const realRoot = await realpath(root)
    const realTarget = await realpath(target)
    this.assertRealContained(realRoot, realTarget, `Refusing to clean a path outside the Arena worktree root: ${worktree}`)
    return target
  }

  private expectedWorktree(matchId: string, contestantId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(matchId) || !/^[a-z0-9][a-z0-9-]{0,31}$/u.test(contestantId)) {
      throw new Error('Invalid Arena match or contestant identity.')
    }
    return resolve(this.worktreeRoot, matchId, contestantId)
  }

  private async ensureWorktreeRoot(): Promise<string> {
    const root = resolve(this.worktreeRoot)
    await mkdir(root, { recursive: true })
    const info = await lstat(root)
    if (info.isSymbolicLink()) throw new Error('Arena worktree root cannot be a symbolic link or junction.')
    return realpath(root)
  }

  private assertRealContained(realRoot: string, realTarget: string, message: string): void {
    const rel = relative(realRoot, realTarget)
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(message)
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
