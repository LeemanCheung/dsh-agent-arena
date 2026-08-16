import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import { DshAgentRunner, GitWorktreeExecutor } from './adapters.ts'
import { ArenaService } from './arena-service.ts'
import { arenaDomainSpec, StorageArenaStore } from './storage.ts'

export * from './models.ts'
export * from './adapters.ts'
export * from './arena-service.ts'
export * from './scoring.ts'
export * from './state.ts'
export * from './storage.ts'

export const inject = ['agents', 'subprocess', 'storageDomain']

export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(arenaDomainSpec)
  const executor = new GitWorktreeExecutor(ctx.subprocess, new DshAgentRunner(ctx.agents))
  const arena = new ArenaService(ctx, { executor, store: new StorageArenaStore(domain) })
  await arena.hydrate()
  ctx.effect(() => async () => {
    await arena.shutdown()
    await domain.close()
  }, 'agent-arena: stop matches and close durable domain')
}
