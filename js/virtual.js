/**
 * MemoDeck · 长列表窗口化的算术（纯逻辑，无 DOM / Vue 依赖）
 * 挂载到 window.ExamVirtual
 *
 * 为什么单独一个文件：窗口化会错的地方全在算术上 —— 哪一行在什么位置、给定
 * scrollTop 该渲染哪几行、某一行展开变高之后它后面的行要整体下移多少。
 * 这些一旦算错，症状是「滚动位置漂移」「底部少一行」，而且**只在长列表上出现**
 * （几十行的列表根本滚不到出错的位置）。所以算术在这里被单测钉住，
 * 组件（components.js 的 window-list）只负责接线与 DOM 记账。
 *
 * 坐标系：offsets[i] = 第 i 行**顶部**相对列表起点的距离，offsets[n] = 列表总高。
 * 行高来源两级：heights[i]（实测回填）优先，缺失则用估算的 rowHeight。
 * 展开行的处理是这套东西的关键 —— 见 test/virtual.test.js 的「一行的实测高度只影响
 * 它自己与后面的行」那一条。
 */
(function (global) {
  'use strict';

  /**
   * 前缀和偏移表；offsets[i] = 第 i 行顶部，offsets[count] = 总高。
   *
   * ⚠️ count 必须由调用方显式给：heights 是**稀疏**数组（只记已实测的行），
   * 拿它的 length 当行数是错的 —— 组件第一次渲染时 heights 是空数组，
   * 推出来的 n=0，整个列表会渲染成空（2026-10-09 真踩过，浏览器门禁抓到、单测没抓到，
   * 因为单测每次喂的都是长度正确的数组）。
   */
  function buildOffsets(count, heights, rowHeight) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const src = heights || [];
    const fallback = Number(rowHeight) > 0 ? Number(rowHeight) : 1;
    const off = new Array(n + 1);
    off[0] = 0;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      off[i + 1] = off[i] + (typeof v === 'number' && v > 0 ? v : fallback);
    }
    return off;
  }

  /**
   * 给定纵向坐标 y，返回它落在哪一行。
   * 边界归**下一行**（y 恰好等于某行顶部时算那一行）：否则视口顶边正好压在行首时会
   * 渲染上一行、露出空白。空表返回 0（上层拿它当不了索引，但也不该拿到 -1）。
   */
  function indexAt(offsets, y) {
    const n = offsets.length - 1;
    if (n <= 0) return 0;
    if (!(y > 0)) return 0;
    if (y >= offsets[n]) return n - 1;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;          // 上取整 → 收敛到「最后一个 offsets[i] <= y」
      if (offsets[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /**
   * 要渲染的行区间 [start, end) 与上下两段占位高度。
   * padTop + 窗口实际高度 + padBottom 恒等于总高 —— 这条恒等式保证滚动条长度稳定。
   */
  function windowRange(offsets, scrollTop, viewportH, buffer) {
    const n = offsets.length - 1;
    const buf = Math.max(0, Number(buffer) || 0);
    if (n <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
    const top = Math.max(0, Number(scrollTop) || 0);
    const vh = Number(viewportH) > 0 ? Number(viewportH) : 1;
    const first = indexAt(offsets, top);
    const last = indexAt(offsets, top + vh);
    const start = Math.max(0, first - buf);
    const end = Math.min(n, last + 1 + buf);
    return { start, end, padTop: offsets[start], padBottom: offsets[n] - offsets[end] };
  }

  /** 回填一行实测高度（不改原数组：组件靠新旧对比决定要不要重排） */
  function applyMeasured(heights, index, measured) {
    const out = Array.from(heights || []);
    out[index] = measured;
    return out;
  }

  global.ExamVirtual = { buildOffsets, indexAt, windowRange, applyMeasured };
})(typeof window !== 'undefined' ? window : globalThis);
