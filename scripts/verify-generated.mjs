import { spawnSync } from 'node:child_process'

const releasePath = 'packages/dsh-agent-arena/lib'
const diff = spawnSync('git', ['diff', '--exit-code', '--', releasePath], { stdio: 'inherit' })
if (diff.error !== undefined) throw diff.error
if (diff.status !== 0) process.exit(diff.status ?? 1)

const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', releasePath], { encoding: 'utf8' })
if (untracked.error !== undefined) throw untracked.error
if (untracked.status !== 0) process.exit(untracked.status ?? 1)
if (untracked.stdout.trim().length > 0) {
  console.error(`Untracked generated artifacts:\n${untracked.stdout.trim()}`)
  process.exit(1)
}
console.log('Committed Agent Arena release artifacts match the fresh build.')
