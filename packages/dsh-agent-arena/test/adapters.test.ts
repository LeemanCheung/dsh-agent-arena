import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { GitWorktreeExecutor, type DshAgentRunner } from '../src/adapters.js'
import type { ArenaConfig } from '../src/models.js'

type Reply={output?:string;lossy?:boolean;code?:number}
function fakeRuntime(replies:Reply[],calls:string[][]):SubprocessRuntime{
  return {spawn(options:{argv:string[]}){calls.push(options.argv);const reply=replies.shift()??{};const stream={readFrom:()=>({text:reply.output??'',lossy:reply.lossy??false})};return {done:Promise.resolve({exitCode:reply.code??0}),collected:{stdout:stream,stderr:{readFrom:()=>({text:'',lossy:false})}}}}} as unknown as SubprocessRuntime
}

describe('GitWorktreeExecutor patch collection',()=>{
  it('collects staged, unstaged, and intent-to-add changes relative to HEAD',async()=>{
    const calls:string[][]=[]
    const executor=new GitWorktreeExecutor(fakeRuntime([{},{output:'patch'},{output:'src/a.ts\nsrc/new.ts\n'}],calls),{} as DshAgentRunner)
    await expect(executor.diff('worktree')).resolves.toEqual({diff:'patch',changedFiles:['src/a.ts','src/new.ts']})
    expect(calls).toEqual([
      ['git','add','-N','--','.'],
      ['git','diff','HEAD','--no-ext-diff','--binary'],
      ['git','diff','HEAD','--name-only'],
    ])
  })

  it('rejects truncated patches before review or application',async()=>{
    const review=new GitWorktreeExecutor(fakeRuntime([{},{output:'partial',lossy:true},{output:'src/a.ts\n'}],[]),{} as DshAgentRunner)
    await expect(review.diff('worktree')).rejects.toThrow('exceeds the 1 MB Arena review limit')

    const apply=new GitWorktreeExecutor(fakeRuntime([{output:'partial',lossy:true}],[]),{} as DshAgentRunner)
    await expect(apply.apply('repository','worktree')).rejects.toThrow('exceeds the 1 MB Arena apply limit')
  })

  it('preserves a failing validation process exit code for scoring', async () => {
    const executor = new GitWorktreeExecutor(fakeRuntime([{ code: 7, output: 'failed' }], []), {} as DshAgentRunner)
    const config = { objective: 'x', repository: 'C:/repo', contestants: [], validation: [{ command: 'corepack pnpm test', weight: 1, timeoutMs: 30_000 }], keepWorktrees: false } as ArenaConfig
    await expect(executor.validate('worktree', config, new AbortController().signal)).resolves.toEqual([
      { command: 'corepack pnpm test', exitCode: 7, durationMs: expect.any(Number), output: 'failed', weight: 1 },
    ])
  })

  it('refuses to recursively clean a path outside its dedicated worktree root', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'arena-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'arena-outside-'))
    const marker = join(outside, 'keep.txt')
    await writeFile(marker, 'keep')
    const executor = new GitWorktreeExecutor(fakeRuntime([], []), {} as DshAgentRunner, worktreeRoot)
    try {
      await expect(executor.cleanup(outside)).rejects.toThrow('outside the Arena worktree root')
      await expect(readFile(marker, 'utf8')).resolves.toBe('keep')
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses cleanup when the dedicated worktree root was replaced by a junction', async () => {
    const container = await mkdtemp(join(tmpdir(), 'arena-container-'))
    const outside = await mkdtemp(join(tmpdir(), 'arena-junction-target-'))
    const worktreeRoot = join(container, 'root-link')
    const target = join(worktreeRoot, '12345678-1234-1234-1234-123456789abc', 'contestant-1')
    const outsideTarget = join(outside, '12345678-1234-1234-1234-123456789abc', 'contestant-1')
    await mkdir(outsideTarget, { recursive: true })
    await writeFile(join(outsideTarget, 'keep.txt'), 'keep')
    await symlink(outside, worktreeRoot, 'junction')
    const executor = new GitWorktreeExecutor(fakeRuntime([], []), {} as DshAgentRunner, worktreeRoot)
    try {
      await expect(executor.cleanup(target)).rejects.toThrow('symbolic link or junction')
      await expect(readFile(join(target, 'keep.txt'), 'utf8')).resolves.toBe('keep')
    } finally {
      await rm(container, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('cleans a valid match/contestant directory inside the dedicated root', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'arena-valid-root-'))
    const target = join(worktreeRoot, '12345678-1234-1234-1234-123456789abc', 'contestant-1')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'remove.txt'), 'remove')
    const executor = new GitWorktreeExecutor(fakeRuntime([], []), {} as DshAgentRunner, worktreeRoot)
    try {
      await expect(executor.cleanup(target)).resolves.toBeUndefined()
      await expect(readFile(join(target, 'remove.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true })
    }
  })

  it('refuses to hand an existing contestant junction to git worktree add', async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), 'arena-create-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'arena-create-outside-'))
    const matchId = '12345678-1234-1234-1234-123456789abc'
    const parent = join(worktreeRoot, matchId)
    const target = join(parent, 'contestant-1')
    await mkdir(parent, { recursive: true })
    await symlink(outside, target, 'junction')
    const calls: string[][] = []
    const executor = new GitWorktreeExecutor(fakeRuntime([], calls), {} as DshAgentRunner, worktreeRoot)
    try {
      await expect(executor.createWorktree('C:/repo', matchId, 'contestant-1')).rejects.toThrow('already exists')
      expect(calls).toEqual([])
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
