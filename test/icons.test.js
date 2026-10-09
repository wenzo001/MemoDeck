/**
 * MemoDeck 3.0 · §4.5 图标构建规则的静态守卫
 *
 * 运行：node test/icons.test.js
 * 无依赖、无框架、无构建步骤。
 *
 * 为什么需要这一份：§4.5 的「图标全部居中」是浏览器里的几何事实，由
 * test/../scripts 的真视口门禁负责；但那次走查揪出的根因是
 * `.icon` 自带 `margin-right: .375em`，而「哪些容器要把这道边距关掉」是一张
 * 枚举表 —— 22 档的 .md-opt-key 被漏掉，2.x 遗留的 .resume-icon 选择器早已
 * 指向不存在的类名。枚举表一定会烂，所以这里用双向差集钉住它：
 *   方向 A：CSS 里凡是「flex 居中 + 正方形」的容器，都必须出现在零边距表里（不许漏）
 *   方向 B：零边距表里每个类名，都必须在模板里真实存在（不许留死选择器）
 * 再加两条：这道机制本体（.icon 的默认边距）必须在，四档尺寸 22/24/30/44 必须各有主人。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'css');
const JS_DIR = path.join(ROOT, 'js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; failures.push({ name, message: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || '值不相等'}\n        实际: ${a}\n        期望: ${e}`);
}

/* ---------- 极简 CSS 解析：注释剥掉，取最内层块 ---------- */
const cssFiles = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css')).sort();
const rules = [];      // { file, selector, decls: {prop: value} }
for (const f of cssFiles) {
  const src = fs.readFileSync(path.join(CSS_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    const decls = {};
    m[2].split(';').forEach(d => {
      const i = d.indexOf(':');
      if (i < 0) return;
      decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().toLowerCase();
    });
    rules.push({ file: f, selector, decls });
  }
}

/* 模板语料：类名在不在这里出现，决定它是不是死选择器 */
const templates = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  + fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8')).join('\n');

const headClass = sel => (sel.match(/\.[A-Za-z][\w-]*/) || [''])[0];
const lastCompound = sel => sel.split(',').map(s => s.trim().split(/\s+|>/).pop()).filter(Boolean);

/* 容器里到底有没有字形？不手工枚举（手工枚举的名单正是这次烂掉的东西），
   而是从模板里读事实：字形一定是容器的第一个子元素，形如
   < span class="X" …><svg … class="icon" >。取不到字形的空方块（.radio-dot 那种
   纯 CSS 画的圆点）不进 §4.5 的居中契约。 */
const glyphHostClasses = new Set();
for (const m of templates.matchAll(/class="([^"]*)"[^>]*>\s*<svg[^>]*class="icon"/g)) {
  m[1].split(/\s+/).filter(Boolean).forEach(c => { if (/^[A-Za-z][\w-]*$/.test(c)) glyphHostClasses.add('.' + c); });
}
/* 类名比对必须按「完整 token」而不是子串：子串比对会让 2.x 的 .resume-icon
   被 .md-resume-icon 蒙过去 —— 那条死选择器正是这样躲过所有目视检查的。 */
const nameOf = cls => cls.slice(1);
const inTemplates = cls => {
  const q = '[\\s"\'`]';
  return new RegExp(q + nameOf(cls).replace(/[-]/g, '\\-') + q).test(templates);
};
const hostsGlyph = cls => glyphHostClasses.has(cls);

/* ---------- 零边距表（[icon-box]）---------- */
const iconBoxRules = rules.filter(r => r.decls['margin-right'] === '0' && r.selector.includes('.icon'));
const zeroMarginClasses = new Set();
iconBoxRules.forEach(r => r.selector.split(',').forEach(part => {
  const cls = part.trim().match(/\.[A-Za-z][\w-]*/g);
  if (cls) cls.slice(0, 1).forEach(c => zeroMarginClasses.add(c));
}));

/* ---------- 「字形独占方形容器」候选：flex + 双向居中 + 宽高相等 ---------- */
const isSquare = d => {
  if (!d.width || !d.height) return false;
  if (d.width !== d.height) return false;
  return /^(\d+(\.\d+)?px|var\(--[\w-]+\))$/.test(d.width);
};
const squareCenters = rules
  .filter(r => (r.decls.display || '').includes('flex')
            && (r.decls['align-items'] || '') === 'center'
            && (r.decls['justify-content'] || '') === 'center'
            && isSquare(r.decls))
  .map(r => ({ selector: r.selector, cls: lastCompound(r.selector).map(c => (c.match(/\.[A-Za-z][\w-]*/) || [''])[0]), decls: r.decls }))
  .filter(x => x.cls.length && x.cls[0])
  .map(x => ({ selector: x.selector, cls: x.cls[0], size: x.decls.width }))
  // 只保留模板里真作为容器出现的类，且该容器确实以第一个子元素承载字形
  .filter(x => hostsGlyph(x.cls) && inTemplates(x.cls));

console.log('\n§4.5 · 图标零外边距表与实际渲染容器双向核对');

test('机制本体在：.icon 确实带默认 margin-right（否则本文件在守一件不存在的事）', () => {
  const base = rules.filter(r => r.selector === '.icon');
  assert(base.length, 'CSS 里找不到 .icon 基础规则');
  const hasMargin = base.some(r => r.decls['margin-right'] && r.decls['margin-right'] !== '0');
  assert(hasMargin, '.icon 不再有默认 margin-right，[icon-box] 零边距表应整条删除，别让死规则留着');
});

test('扫描确有内容：找到 ≥4 个 flex 居中的方形图标容器', () => {
  assert(squareCenters.length >= 4,
    '只扫到 ' + squareCenters.length + ' 个方形容器：判据在扫空气，先看解析器有没有坏\n        '
    + squareCenters.map(s => s.cls).join(', '));
});

test('方向 A · 每个方形居中的图标容器都在零边距表里（漏一个 = 字形必然偏心）', () => {
  const missing = squareCenters.filter(s => !zeroMarginClasses.has(s.cls))
    .map(s => `${s.cls}(${s.size}) ← ${s.selector}`);
  eq(missing, [], '这些容器里的字形还带着 .icon 的默认右外边距');
});

test('方向 B · 零边距表里没有死选择器（2.x 的 .resume-icon 就是这么烂掉的）', () => {
  const dead = [...zeroMarginClasses].filter(c => !inTemplates(c));
  eq(dead, [], '这些类名在模板里已经不存在');
});

test('§4.5 四档 22 / 24 / 30 / 44 各有主人，且都在零边距表里', () => {
  const token = fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8');
  const resolve = v => {
    const m = v.match(/^var\(--([\w-]+)\)$/);
    if (!m) return parseFloat(v);
    const d = token.match(new RegExp('--' + m[1] + ':\\s*([\\d.]+)px'));
    return d ? parseFloat(d[1]) : NaN;
  };
  const sizes = new Map();
  squareCenters.forEach(s => {
    const px = resolve(s.size);
    if (!Number.isNaN(px)) sizes.set(Math.round(px), s.cls);
  });
  [22, 24, 30, 44].forEach(t => {
    assert(sizes.has(t), `${t} 档没有一个 flex 居中的方形容器（§4.5 要求 22/24/30/44 四档逐一核对）`);
    assert(zeroMarginClasses.has(sizes.get(t)), `${t} 档的 ${sizes.get(t)} 不在零边距表里`);
  });
});

test('零边距表带 [icon-box] 标记注释，改动时能被检索到', () => {
  const src = fs.readFileSync(path.join(CSS_DIR, 'components.css'), 'utf8');
  assert(/\[icon-box\]/.test(src), 'components.css 里应有 [icon-box] 标记，说明这张表的取舍');
});

console.log('\n' + '─'.repeat(46));
if (failed) {
  console.log(`✗ 失败 ${failed} / ${passed + failed}`);
  failures.forEach(f => console.log(`  · ${f.name}: ${f.message}`));
  process.exit(1);
} else {
  console.log(`✓ 全部通过：${passed} 项（方形容器 ${squareCenters.length} 个，零边距表 ${zeroMarginClasses.size} 个类名）`);
}
