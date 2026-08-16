import { existsSync } from 'node:fs'

const root = new URL('../packages/dsh-agent-arena/lib/', import.meta.url)
const required = ['index.js', 'index.d.ts', 'client.js', 'client.d.ts', 'typert.host.js', 'typert.host.d.ts', 'typert.remote-client.js', 'typert.remote-client.d.ts']
const missing = required.filter(file => !existsSync(new URL(file, root)))
if (missing.length > 0) {
  console.error('Missing release artifacts:', missing.join(', '))
  process.exit(1)
}
console.log('Verified release artifacts for dsh-agent-arena.')
