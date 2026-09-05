import { clientBundle } from '../../build/plugin-bundle.ts'
import { fileURLToPath } from 'node:url'
const packageRoot = fileURLToPath(new URL('.', import.meta.url))
export default clientBundle('dsh-agent-arena', packageRoot)
