import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import type { ArenaStore } from './arena-service.ts'
import { ArenaMatchSchema, type ArenaMatch } from './models.ts'

export const arenaDomainSpec = defineDomain({
  name: 'agent_arena',
  version: 1,
  tables: { matches: domainTable<string, ArenaMatch>(ArenaMatchSchema) },
})

export class StorageArenaStore implements ArenaStore {
  constructor(private readonly domain: Domain<typeof arenaDomainSpec>) {}

  async load(): Promise<ArenaMatch[]> {
    return [...this.domain.table('matches').entries()].map(([, match]) => structuredClone(match))
  }

  async save(matches: ArenaMatch[]): Promise<void> {
    const table = this.domain.table('matches')
    const retained = new Set(matches.map(match => match.id))
    for (const [id] of table.entries()) if (!retained.has(id)) await table.delete(id)
    for (const match of matches) await table.put(match.id, structuredClone(match))
  }
}
