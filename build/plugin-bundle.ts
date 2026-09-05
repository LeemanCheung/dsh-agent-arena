import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type UserConfig } from 'tsdown'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

const platformModules = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-renderer/client', '@deepseek-ai/dsh-api-remotes/client',
  '@deepseek-ai/dsh-client-ui-settings/client', '@deepseek-ai/dsh-client-ui-theme/client',
] as const

const cssPrefix = '\0dsh-community-css:'
const cssSuffix = '.mjs'

function normalizeTypertJsDocs(value: string): string {
  return value.replace(/"jsDoc":\s*"(?:\\.|[^"\\])*"/g, match => match.replaceAll('\\r\\n', '\\n'))
}

function normalizeGeneratedDeclaration(value: string): string {
  return value.replace(/z\.ZodEnum<\{\n((?:  [^\n]+\n)+)\}>/g, (match, body: string) => {
    const sorted = body.trimEnd().split('\n').sort((left, right) => left.localeCompare(right)).join('\n')
    return `z.ZodEnum<{\n${sorted}\n}>`
  })
}

function normalizeSourceMaps(output: string): void {
  for (const file of readdirSync(output).filter(file => file.endsWith('.map'))) {
    const path = resolve(output, file)
    const map = JSON.parse(readFileSync(path, 'utf8')) as { sources?: string[]; sourcesContent?: unknown }
    if (map.sources !== undefined) map.sources = map.sources.map(source => source.replaceAll('\\', '/'))
    delete map.sourcesContent
    writeFileSync(path, JSON.stringify(map))
  }
}

function packageTypertPlugin(packageRoot: string) {
  const official = typertPlugin({ mode: 'package', faces: ['host'] })
  return {
    ...official,
    writeBundle() {
      const workspaceRoot = resolve(packageRoot, '..', '..')
      const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { name: string }
      const artifacts = new WorkspaceTypertGenerator(workspaceRoot).generate([manifest.name], ['host'])
      const output = resolve(packageRoot, 'lib')
      mkdirSync(output, { recursive: true })
      let emittedRemote = false
      for (const artifact of artifacts) {
        writeFileSync(resolve(output, `typert.${artifact.face}.js`), normalizeTypertJsDocs(artifact.js))
        writeFileSync(resolve(output, `typert.${artifact.face}.d.ts`), artifact.dts)
        if (artifact.remote === undefined) continue
        emittedRemote = true
        writeFileSync(resolve(output, 'typert.remote-client.js'), normalizeTypertJsDocs(artifact.remote.js))
        writeFileSync(resolve(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
        writeFileSync(resolve(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
      }
      if (!emittedRemote) {
        for (const file of ['typert.remote-client.js', 'typert.remote-client.d.ts', 'typert.remote-client.d.ts.map']) {
          rmSync(resolve(output, file), { force: true })
        }
      }
    },
  }
}

/** Build an externalized Node Host entry and emit this package's Typert artifacts. */
export function hostBundle(packageRoot: string, entries: Record<string, string> = { index: 'src/index.ts' }): ReturnType<typeof defineConfig> {
  return defineConfig({
    entry: Object.fromEntries(Object.entries(entries).map(([name, path]) => [name, resolve(packageRoot, path)])),
    outDir: resolve(packageRoot, 'lib'),
    tsconfig: resolve(packageRoot, 'tsconfig.json'),
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    sourcemap: true,
    clean: false,
    plugins: [packageTypertPlugin(packageRoot), {
      name: 'dsh-community-stable-declarations',
      closeBundle() {
        const output = resolve(packageRoot, 'lib')
        const declaration = resolve(output, 'index.d.ts')
        if (existsSync(declaration)) writeFileSync(declaration, normalizeGeneratedDeclaration(readFileSync(declaration, 'utf8')))
        normalizeSourceMaps(output)
      },
    }],
    outputOptions: { chunkFileNames: '[name].js' },
  })
}

/** Build a DSH browser closure-factory with inlined CSS Modules and Remote descriptors. */
export function clientBundle(packageName: string, packageRoot: string): ReturnType<typeof defineConfig> {
  const cssFiles = new Map<string, { filename: string; stableName: string }>()
  const config: UserConfig = {
    entry: { client: resolve(packageRoot, 'src/client/index.tsx') },
    outDir: resolve(packageRoot, 'lib'),
    tsconfig: resolve(packageRoot, 'tsconfig.json'),
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: true,
    sourcemap: true,
    minify: true,
    clean: false,
    deps: { neverBundle: [...platformModules], alwaysBundle: ['zod'], onlyBundle: false },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'dsh-community-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const filename = resolve(importer === undefined ? packageRoot : dirname(importer), source)
        const stableName = relative(packageRoot, filename).replaceAll('\\', '/')
        const id = cssPrefix + stableName + cssSuffix
        cssFiles.set(id, { filename, stableName })
        return id
      },
      async load(id: string) {
        if (!id.startsWith(cssPrefix)) return null
        const resolved = cssFiles.get(id)
        if (resolved === undefined) throw new Error(`Unknown CSS module: ${id}`)
        const { filename, stableName } = resolved
        this.addWatchFile(filename)
        const result = transform({
          filename: stableName,
          code: await readFile(filename),
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classes: Record<string, string> = {}
        const exports = Object.entries(result.exports ?? {}).sort(([left], [right]) => left.localeCompare(right))
        for (const [local, entry] of exports) classes[local] = entry.name
        return [
          `const css=${JSON.stringify(result.code.toString())};`,
          `const tagId=${JSON.stringify(`${packageName}/${basename(filename)}`)};`,
          "if(typeof document!=='undefined'&&!document.querySelector('style[data-plugin-css='+JSON.stringify(tagId)+']')){",
          "const tag=document.createElement('style');",
          `tag.dataset.plugin=${JSON.stringify(packageName)};`,
          'tag.dataset.pluginCss=tagId;tag.textContent=css;document.head.appendChild(tag);}',
          `export default ${JSON.stringify(classes)};`,
        ].join('\n')
      },
    }, {
      name: 'dsh-community-client-declaration',
      closeBundle() {
        const output = resolve(packageRoot, 'lib')
        writeFileSync(resolve(output, 'client.d.ts'), [
          "import type { Context } from '@deepseek-ai/cordis'",
          'export declare const inject: readonly string[]',
          'export declare function apply(ctx: Context): void | Promise<void | (() => void | Promise<void>)>',
          '',
        ].join('\n'))
        const client = resolve(output, 'client.js')
        if (existsSync(client)) writeFileSync(client, readFileSync(client, 'utf8').replace(/[\t ]+$/gm, ''))
        normalizeSourceMaps(output)
        rmSync(resolve(output, 'client.ts.map'), { force: true })
        rmSync(resolve(output, 'tsconfig.tsbuildinfo'), { force: true })
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({id:${JSON.stringify(packageName)},factory:(require)=>{`,
      intro: 'var module={exports:{}};var exports=module.exports;',
      footer: 'return module.exports;}});',
    },
  }
  return defineConfig(config)
}
