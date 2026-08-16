import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
const json = { mode: 'src-json' } as const
const descriptor = (method: string, parameters: string[]): TypertRemoteContribution['descriptors'][number] => ({ id: `dsh-agent-arena#agentArena/${method}`, service: 'agentArena', namespace: 'agentArena', method, invocation: { kind: 'direct' }, parameters: parameters.map(name => ({ name, wire: name, source: 'json', codec: json })), result: json })
/** Explicit client contribution kept in source so the UI can mount before generated artifacts exist. */
const TYPERT_REMOTE: TypertRemoteContribution = { package: 'dsh-agent-arena', descriptors: [descriptor('list', ['limit']), descriptor('get', ['id']), descriptor('start', ['input']), descriptor('cancel', ['id']), descriptor('applyWinner', ['id'])] }
export default TYPERT_REMOTE
