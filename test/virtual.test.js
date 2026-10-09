/**
 * 长列表窗口化的纯函数测试（js/virtual.js）
 *
 * 运行：node test/virtual.test.js
 * 无依赖、无框架、无构建步骤。
 *
 * 为什么把逻辑抽成纯函数：窗口化的正确性全在「偏移表」上 —— 哪一行在什么位置、
 * 给定 scrollTop 该渲染哪几行、展开行变高后后面的行要下移多少。
 * 这套算术一旦错，症状是「滚动位置漂移 / 列表底部少一行」，而且只在长列表上出现。
 * 组件里只剩接线与 DOM 记账，算术全部在这里被钉住。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'virtual.js'), 'utf8'), { filename: 'virtual.js' });
const V = global.ExamVirtual;

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

console.log('\n偏移表 · 等高铁律与实测回填');

test('等高列表：offsets 是等差数列，末项 = 总高', () => {
  const off = V.buildOffsets(5, new Array(5), 100);
  eq(Array.from(off), [0, 100, 200, 300, 400, 500]);
});

test('空列表：只有 origin，不崩', () => {
  const off = V.buildOffsets(0, [], 100);
  eq(Array.from(off), [0]);
  eq(V.indexAt(off, 0), 0, '空列表取行号必须夹到 0，不能返回 -1 让上层拿到 undefined');
  eq(V.indexAt(off, 99999), 0);
});

test('行数由 count 决定，不从 heights 的 length 推（稀疏记账的合同）', () => {
  /* 这条是真实事故的回归：组件里的 heights 是**稀疏**数组（只记已实测的行），
     第一次渲染时它是 []。旧签名从 heights.length 推行数 → n=0 → 整个列表渲染成空。
     单测当时全绿，因为每次喂的都是长度正确的数组；浏览器门禁才抓到。 */
  eq(Array.from(V.buildOffsets(5, [], 100)), [0, 100, 200, 300, 400, 500],
     'heights 为空数组时，5 行仍须按估算行高铺出 5 行');
  eq(Array.from(V.buildOffsets(3, [undefined, 260], 100)), [0, 100, 360, 460],
     '稀疏数组：已知的用实测值，未测的用估算值');
  eq(Array.from(V.buildOffsets(0, [200, 300], 100)), [0], 'count=0 时不许把 heights 里的值算进来');
});

test('一行的实测高度只影响它自己与后面的行（前面的行不许动）', () => {
  const heights = [undefined, undefined, undefined];
  const grown = V.applyMeasured(heights, 1, 260);       // 第 1 行展开，比估值高
  eq(GArray(grown), [undefined, 260, undefined]);
  const off = V.buildOffsets(3, grown, 100);
  eq(Array.from(off), [0, 100, 360, 460], '第 0 行仍是 0–100，第 1 行 100–360，第 2 行从 360 起');
});

test('applyMeasured 不改原数组（纯函数）', () => {
  const heights = [undefined, undefined];
  V.applyMeasured(heights, 0, 200);
  eq(GArray(heights), [undefined, undefined], '原数组被就地改了：组件里会导致「已测过」的记账与渲染不同步');
});

function GArray(a) { return Array.from(a, x => (x === undefined ? undefined : x)); }

console.log('\n二分定位 · indexAt');

test('命中行首 / 行中 / 行尾', () => {
  const off = V.buildOffsets(4, new Array(4), 100);      // 0,100,200,300,400
  eq(V.indexAt(off, 0), 0);
  eq(V.indexAt(off, 50), 0);
  eq(V.indexAt(off, 100), 1, '恰好在边界上应归下一行（否则会渲染上一行、露出空白）');
  eq(V.indexAt(off, 150), 1);
  eq(V.indexAt(off, 399), 3);
});

test('超出末尾夹到最后一行，负数夹到第一行', () => {
  const off = V.buildOffsets(4, new Array(4), 100);
  eq(V.indexAt(off, 400), 3);
  eq(V.indexAt(off, 99999), 3);
  eq(V.indexAt(off, -50), 0);
});

test('变高行里定位：展开到 260 的第 1 行内部任意 y 都归它', () => {
  const grown = V.applyMeasured([undefined, undefined, undefined], 1, 260);
  const off = V.buildOffsets(3, grown, 100);           // 0,100,360,460
  eq(V.indexAt(off, 99), 0);
  eq(V.indexAt(off, 100), 1);
  eq(V.indexAt(off, 359), 1);
  eq(V.indexAt(off, 360), 2);
});

console.log('\n窗口区间 · windowRange');

test('列表顶部：上方无占位，下方是剩余全部', () => {
  const off = V.buildOffsets(100, new Array(100), 100);
  const r = V.windowRange(off, 0, 600, 2);
  eq(r.start, 0);
  // 视口 600px 覆盖 y∈[0,600]，落在第 0…6 行（600 正好是第 6 行的顶边，算它），
  // 加 1 行跨边界余量与上下各 2 行缓冲 → end = 6+1+2 = 9。
  // 多渲染一行是有意的：宁可多一行的开销，也不要因为边界取整出现一帧空白。
  eq(r.end, 9);
  eq(r.padTop, 0);
  eq(r.padBottom, (100 - r.end) * 100);
});

test('列表中段：上下都有占位，且占位 + 窗口高度 = 总高', () => {
  const off = V.buildOffsets(100, new Array(100), 100);
  const r = V.windowRange(off, 5000, 600, 2);
  assert(r.padTop > 0 && r.padBottom > 0, '中段的上下占位都应大于 0');
  const winH = off[r.end] - off[r.start];
  eq(Math.round(r.padTop + winH + r.padBottom), off[100], '三段之和必须等于总高，否则滚动条长度会随滚动变化');
});

test('列表底部：下方无占位，end 不会超过总数', () => {
  const off = V.buildOffsets(100, new Array(100), 100);
  const r = V.windowRange(off, 9900, 600, 2);
  eq(r.end, 100);
  eq(r.padBottom, 0);
});

test('空列表：区间为空且两个占位都是 0', () => {
  const off = V.buildOffsets(0, [], 100);
  eq(V.windowRange(off, 0, 600, 2), { start: 0, end: 0, padTop: 0, padBottom: 0 });
});

test('2000 行长列表：任何位置渲染的行数都有上界（这条是「窗口化真的生效」的形状判据）', () => {
  const n = 2000;
  const off = V.buildOffsets(n, new Array(n), 120);
  const cap = Math.ceil(844 / 120) + 1 + 2 * 6;
  let worst = 0;
  for (let y = 0; y <= off[n]; y += 137) {            // 137 与行高互质，扫过各种边界
    const r = V.windowRange(off, y, 844, 6);
    worst = Math.max(worst, r.end - r.start);
    assert(r.end <= n && r.start >= 0, '区间越界');
    assert(r.end > r.start, '扫到空窗口：' + y);
  }
  assert(worst <= cap, `最坏一次渲染 ${worst} 行，超过上界 ${cap}`);
});

test('窗口在 2000 行里滚动时，padTop 单调不减（滚动位置与视觉位置一一对应）', () => {
  const n = 2000;
  const off = V.buildOffsets(n, new Array(n), 120);
  let prev = -1;
  for (let y = 0; y < 3000; y += 60) {
    const r = V.windowRange(off, y, 844, 6);
    assert(r.padTop >= prev, `y=${y} 时 padTop 回退了：${r.padTop} < ${prev}`);
    prev = r.padTop;
  }
});

/* ---------- 汇总 ---------- */
console.log('\n' + '─'.repeat(46));
if (failed) {
  console.log(`✗ 失败 ${failed} / ${passed + failed}`);
  failures.forEach(f => console.log(`  · ${f.name}: ${f.message}`));
  process.exit(1);
} else {
  console.log(`✓ 全部通过：${passed} 项`);
}
