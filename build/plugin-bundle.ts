import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type UserConfig } from 'tsdown'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

const platformModules = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form', '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-api-remotes/client', '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/dsh-client-ui-settings/client', '@deepseek-ai/dsh-client-ui-theme/client',
] as const

const cssPrefix = '\0dsh-community-css:'
const cssSuffix = '.mjs'

function packageTypertPlugin() {
  const official = typertPlugin({ mode: 'package', faces: ['host'] })
  return {
    ...official,
    writeBundle() {
      const packageRoot = process.cwd()
      const workspaceRoot = resolve(packageRoot, '..', '..')
      const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { name: string }
      const artifacts = new WorkspaceTypertGenerator(workspaceRoot).generate([manifest.name], ['host'])
      const output = resolve(packageRoot, 'lib')
      mkdirSync(output, { recursive: true })
      let emittedRemote = false
      for (const artifact of artifacts) {
        writeFileSync(resolve(output, `typert.${artifact.face}.js`), artifact.js)
        writeFileSync(resolve(output, `typert.${artifact.face}.d.ts`), artifact.dts)
        if (artifact.remote === undefined) continue
        emittedRemote = true
        writeFileSync(resolve(output, 'typert.remote-client.js'), artifact.remote.js)
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
export function hostBundle(): ReturnType<typeof defineConfig> {
  return defineConfig({
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    sourcemap: true,
    clean: false,
    plugins: [packageTypertPlugin()],
  })
}

/** Build a DSH browser closure-factory with inlined CSS Modules and Remote descriptors. */
export function clientBundle(packageName: string): ReturnType<typeof defineConfig> {
  const config: UserConfig = {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: true,
    sourcemap: true,
    clean: false,
    external: [...platformModules],
    noExternal: (id: string) => platformModules.includes(id as never) ? undefined : true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'dsh-community-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        return cssPrefix + resolve(importer === undefined ? '.' : dirname(importer), source) + cssSuffix
      },
      async load(id: string) {
        if (!id.startsWith(cssPrefix)) return null
        const filename = id.slice(cssPrefix.length, -cssSuffix.length)
        this.addWatchFile(filename)
        const result = transform({
          filename,
          code: await readFile(filename),
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classes: Record<string, string> = {}
        for (const [local, entry] of Object.entries(result.exports ?? {})) classes[local] = entry.name
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
        const output = resolve(process.cwd(), 'lib')
        writeFileSync(resolve(output, 'client.d.ts'), [
          "import type { Context } from '@deepseek-ai/cordis'",
          'export declare const inject: readonly string[]',
          'export declare function apply(ctx: Context): void | Promise<void | (() => void | Promise<void>)>',
          '',
        ].join('\n'))
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
