/**
 * 从 assets/logo.svg 栅格化 PWA 图标。
 *
 * 运行：node tools/make-icons.mjs      （需要 devDependency: sharp，应用运行时零依赖不受影响）
 *
 * 为什么留着这个脚本：icon-192/512 是二进制产物，改设计后必须能**重新生成**而不是手工替换；
 * 图标源是矢量 SVG，色值直接取自 css/tokens.css（--md-ink / --md-amber / 纸色）。
 * manifest.json 声明 purpose: "any maskable"，所以 SVG 里所有内容都落在中心安全区内。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets', 'logo.svg'));

for (const size of [192, 512]) {
  const out = join(root, 'assets', `icon-${size}.png`);
  await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  console.log(`  ok  assets/icon-${size}.png`);
}
