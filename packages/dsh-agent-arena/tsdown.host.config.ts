import { hostBundle } from '../../build/plugin-bundle.ts'
import { fileURLToPath } from 'node:url'
const packageRoot = fileURLToPath(new URL('.', import.meta.url))
export default hostBundle(packageRoot)
