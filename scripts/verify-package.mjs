import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageRoot = join(repositoryRoot, 'packages', 'dsh-agent-arena')
const libRoot = join(packageRoot, 'lib')
const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const nestedPackage = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const errors = []

if (rootPackage.version !== nestedPackage.version) errors.push('root and nested package versions differ')
const required = ['index.js', 'index.d.ts', 'client.js', 'client.d.ts', 'typert.host.js', 'typert.host.d.ts', 'typert.remote-client.js', 'typert.remote-client.d.ts']
for (const file of required) if (!existsSync(join(libRoot, file))) errors.push(`missing release artifact: ${file}`)

for (const [label, manifest] of [['root', rootPackage], ['nested', nestedPackage]]) {
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh-') && range !== '0.1.2-rc.1') errors.push(`${label} peer ${name} is ${range}`)
  }
  const inject = manifest.dsh?.client?.inject ?? []
  if (!inject.includes('@deepseek-ai/dsh-client-ui-renderer')) errors.push(`${label} client manifest does not inject the 0.1.2 renderer`)
  if (inject.includes('@deepseek-ai/dsh-client-runtime')) errors.push(`${label} client manifest still injects removed dsh-client-runtime`)
  const compatibility = manifest.dsh?.compatibility
  if (compatibility?.dsh !== '>=0.1.2-rc.1 <0.1.3-0') errors.push(`${label} compatibility range does not target the tested 0.1.2 release line`)
  if (compatibility?.dshReleases?.['0.1.2-rc.1'] !== 'compatible') errors.push(`${label} does not record the tested 0.1.2-rc.1 release as compatible`)
  if (JSON.stringify(compatibility?.profiles) !== JSON.stringify(['web'])) errors.push(`${label} compatibility profiles must be exactly ["web"]`)
}

const buildInputs = ['package.json', 'packages/dsh-agent-arena/package.json', 'build/plugin-bundle.ts', 'packages/dsh-agent-arena/src/client/index.tsx', 'packages/dsh-agent-arena/lib/client.js']
for (const file of buildInputs) if (readFileSync(join(repositoryRoot, file), 'utf8').includes('@deepseek-ai/dsh-client-runtime')) errors.push(`${file} still references removed dsh-client-runtime`)
for (const file of readdirSync(libRoot).filter(file => file.endsWith('.map'))) {
  const map = JSON.parse(readFileSync(join(libRoot, file), 'utf8'))
  if (Object.hasOwn(map, 'sourcesContent')) errors.push(`${file} embeds platform-dependent source contents`)
  for (const source of map.sources ?? []) if (isAbsolute(source) || /^[a-z]:[\\/]/iu.test(source) || source.includes('\\')) errors.push(`${file} contains a machine-specific source path: ${source}`)
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('Verified dsh-agent-arena 0.1.2-rc.1 dependency graph and portable release artifacts.')
