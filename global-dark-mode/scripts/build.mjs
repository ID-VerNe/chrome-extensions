// Build script — 使用 esbuild 打包内容脚本（含 darkreader）和 popup/options 入口。
// 输出到 dist/ 目录，保持 manifest.json 中引用的路径结构。

import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const SRC = resolve(import.meta.dirname, '../src');
const DIST = resolve(import.meta.dirname, '../dist');
const ICONS_DIR = resolve(import.meta.dirname, '../icons');

// 1. 内容脚本：需要将 darkreader 作为 ESM 依赖 bundle 进 IIFE
// 同时需要 setFetchMethod 和 chrome.storage 访问，所以必须打包
async function buildContent() {
  console.log('[build] 内容脚本...');
  await esbuild.build({
    entryPoints: [resolve(SRC, 'content/inject.js')],
    bundle: true,
    minify: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: resolve(DIST, 'content/inject.js'),
    sourcemap: true,
  });
  console.log('  -> dist/content/inject.js');
}

// 2. Popup 入口文件
async function buildPopup() {
  console.log('[build] 弹出面板...');
  await esbuild.build({
    entryPoints: [resolve(SRC, 'popup/popup.js')],
    bundle: true,
    minify: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: resolve(DIST, 'popup/popup.js'),
    sourcemap: true,
  });
  console.log('  -> dist/popup/popup.js');
}

// 3. Options 入口文件
async function buildOptions() {
  console.log('[build] 选项页面...');
  await esbuild.build({
    entryPoints: [resolve(SRC, 'options/options.js')],
    bundle: true,
    minify: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: resolve(DIST, 'options/options.js'),
    sourcemap: true,
  });
  console.log('  -> dist/options/options.js');
}

// 4. Background SW — 在 SW 中 import.meta 可能不可用，最好不要 bundle
// 不过 esbuild 可以帮我们打包 import 的 shared 模块
async function buildBackground() {
  console.log('[build] Service Worker...');
  await esbuild.build({
    entryPoints: [resolve(SRC, 'background/sw.js')],
    bundle: true,
    minify: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: resolve(DIST, 'background/sw.js'),
    sourcemap: true,
  });
  console.log('  -> dist/background/sw.js');
}

// 5. 复制静态资源
async function copyStatic() {
  console.log('[build] 静态资源...');

  // manifest.json
  await mkdir(resolve(DIST, 'src'), { recursive: true });
  // 直接复制根目录下的 manifest
  // 注意：manifest.json 中引用的路径是 dist 目录下的相对路径
  // 我们手动写一个 dist 下的 manifest.json
  const manifestRaw = await readFile(resolve(SRC, 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw);
  // 调整路径：内容脚本引用 dist 下打包后的文件
  // 第一个 entry 是 flash-block.css（只有 css，没有 js）
  manifest.content_scripts[0].css = ['content/flash-block.css'];
  // 第二个 entry 是 inject.js（只有 js，没有 css）
  manifest.content_scripts[1].js = ['content/inject.js'];
  manifest.background.service_worker = 'background/sw.js';
  manifest.action.default_popup = 'popup/popup.html';
  manifest.options_ui.page = 'options/options.html';
  await writeFile(resolve(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('  -> dist/manifest.json');

  // popup HTML+CSS
  await mkdir(resolve(DIST, 'popup'), { recursive: true });
  await cp(resolve(SRC, 'popup/popup.html'), resolve(DIST, 'popup/popup.html'));
  await cp(resolve(SRC, 'popup/popup.css'), resolve(DIST, 'popup/popup.css'));
  console.log('  -> dist/popup/');

  // content CSS (flash-block)
  await mkdir(resolve(DIST, 'content'), { recursive: true });
  await cp(resolve(SRC, 'content/flash-block.css'), resolve(DIST, 'content/flash-block.css'));
  console.log('  -> dist/content/flash-block.css');

  // options HTML+CSS
  await mkdir(resolve(DIST, 'options'), { recursive: true });
  await cp(resolve(SRC, 'options/options.html'), resolve(DIST, 'options/options.html'));
  await cp(resolve(SRC, 'options/options.css'), resolve(DIST, 'options/options.css'));
  console.log('  -> dist/options/');
}

// 6. 从源图生成各尺寸图标
async function generateIcons() {
  console.log('[build] 图标...');
  await mkdir(ICONS_DIR, { recursive: true });

  // 查找源图（GPT Image 2 生成的图标）
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(ICONS_DIR);
  const source = files.find((f) => f.endsWith('.png') && (f.startsWith('微信图片_') || f === 'source.png'));
  if (!source) {
    console.log('  ⚠ 未找到源图，跳过图标生成');
    return;
  }

  const sharp = (await import('sharp')).default;
  const srcPath = resolve(ICONS_DIR, source);

  // 生成 PNG 各尺寸 + 复制到 dist
  await mkdir(resolve(DIST, 'icons'), { recursive: true });
  for (const s of [16, 48, 128]) {
    const out = resolve(ICONS_DIR, `icon-${s}.png`);
    await sharp(srcPath).resize(s, s, { fit: 'cover', position: 'center' }).png().toFile(out);
    await cp(out, resolve(DIST, `icons/icon-${s}.png`));
  }
  console.log('  -> icons/icon-{16,48,128}.png');
  console.log('  -> dist/icons/');
}

async function main() {
  const start = performance.now();
  console.log(`\n=== 构建 Global Dark Mode ===\n`);

  await mkdir(DIST, { recursive: true });

  await buildContent();
  await buildPopup();
  await buildOptions();
  await buildBackground();
  await copyStatic();
  await generateIcons();

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`\n完成。用时 ${elapsed}s，输出到 ${DIST}`);
}

main().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});