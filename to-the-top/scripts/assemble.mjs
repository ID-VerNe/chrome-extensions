/**
 * assemble.mjs — Build script for the Manifest V3 Chrome extension.
 *
 * Steps:
 *   1. Build the content script as a self-contained IIFE bundle (content
 *      scripts are injected as classic scripts — top-level ESM `import` /
 *      `export` would throw `SyntaxError`).
 *   2. Build the options page as an ES module (loaded via `<script type="module">`).
 *   3. Copy static assets (icons).
 *   4. Read `src/options/index.html`, rewrite the script src to the built bundle.
 *   5. Derive `dist/manifest.json` from the source `manifest.json`, rewriting
 *      `src/...` paths to their built locations.
 */

import { build } from 'vite'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { resolve, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SRC = resolve(ROOT, 'src')
const DIST = resolve(ROOT, 'dist')

/**
 * Build a single entry as a self-contained bundle.
 * @param input  absolute path to the .ts entry
 * @param name   rollup input key + output basename (without ext)
 * @param format 'iife' for content script, 'es' for options page
 */
async function buildEntry(input, name, format) {
  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: DIST,
      emptyOutDir: false,
      sourcemap: true,
      minify: true,
      rollupOptions: {
        input: { [name]: input },
        output: {
          format,
          entryFileNames: 'js/[name].js',
          chunkFileNames: 'js/[name]-[hash].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  })
}

async function main() {
  const srcManifest = JSON.parse(
    readFileSync(resolve(ROOT, 'manifest.json'), 'utf-8'),
  )

  // Clean dist
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(resolve(DIST, 'js'), { recursive: true })

  // 1. Content script — IIFE (classic script, no top-level ESM)
  await buildEntry(
    resolve(SRC, 'content-script/main.ts'),
    'main',
    'iife',
  )
  console.log('content script built (iife)')

  // 2. Options page — ES module
  await buildEntry(
    resolve(SRC, 'options/options.ts'),
    'options',
    'es',
  )
  console.log('options page built (esm)')

  // 3. Copy icons
  mkdirSync(resolve(DIST, 'assets'), { recursive: true })
  for (const size of ['16', '48', '128']) {
    copyFileSync(
      resolve(SRC, `assets/icon-${size}.svg`),
      resolve(DIST, `assets/icon-${size}.svg`),
    )
  }
  console.log('icons copied')

  // 4. Options HTML — read source, rewrite script src
  const srcOptionsHtml = readFileSync(
    resolve(SRC, 'options/index.html'),
    'utf-8',
  )
  const distOptionsHtml = srcOptionsHtml.replace(
    'src="./options.ts"',
    'src="js/options.js"',
  )
  writeFileSync(resolve(DIST, 'options.html'), distOptionsHtml)
  console.log('options.html written')

  // 5. Derive dist manifest from source manifest
  const distManifest = deriveManifest(srcManifest)
  writeFileSync(
    resolve(DIST, 'manifest.json'),
    JSON.stringify(distManifest, null, 2),
  )
  console.log('manifest.json derived')

  console.log('\nBuild complete. Load dist/ in chrome://extensions (Developer mode).')
}

/**
 * Rewrite `src/...` paths in the source manifest to their built locations.
 * - `content_scripts[].js[]`: `src/.../*.ts` → `js/{basename}.js`
 * - `icons` / `action.default_icon`: `src/assets/...` → `assets/...`
 * - `options_page`: `src/options/index.html` → `options.html`
 * All other fields pass through verbatim.
 */
function deriveManifest(src) {
  const out = { ...src }

  // Rewrite content script entries
  if (Array.isArray(out.content_scripts)) {
    out.content_scripts = out.content_scripts.map((cs) => ({
      ...cs,
      js: cs.js.map((p) => rewriteContentScriptPath(p)),
    }))
  }

  // Rewrite options_page
  if (out.options_page && out.options_page.startsWith('src/')) {
    out.options_page = 'options.html'
  }

  // Rewrite icons
  if (out.icons) {
    out.icons = rewriteIconMap(out.icons)
  }
  if (out.action?.default_icon) {
    out.action = {
      ...out.action,
      default_icon: rewriteIconMap(out.action.default_icon),
    }
  }

  return out
}

function rewriteContentScriptPath(p) {
  // `src/content-script/main.ts` → `js/main.js`
  return `js/${basename(p, '.ts')}.js`
}

function rewriteIconMap(map) {
  const result = {}
  for (const [size, path] of Object.entries(map)) {
    // `src/assets/icon-16.svg` → `assets/icon-16.svg`
    result[size] = path.replace(/^src\//, '')
  }
  return result
}

main().catch((e) => {
  console.error('Build failed:', e)
  process.exit(1)
})
