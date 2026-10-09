/**
 * MemoDeck 3.0 · 导航与向后兼容映射（纯逻辑，无 DOM / Vue 依赖）
 * 挂载到 window.ExamNav
 *
 * DESIGN.md §5.1 把 8 个入口收敛成 4 个一级导航，§7.4.2 要求旧题库的开关键名
 * 不改名、不删除。这两件事都是「界面换了、数据没换」，所以映射表必须能独立被测——
 * 它一旦错了，用户的旧书签、旧恢复点、旧题库开关会同时失效，而这些都只在真机上才看得见。
 *
 * 关键不变量（test/navigation.test.js 逐条守）：
 *  1. 模式到 session mode 的映射保持 2.x 的原名（study/exercise/exam/…），
 *     旧恢复点不改版就能继续读。
 *  2. 旧 hash 全部有落点，且**新格式优先**；裸的 #/practice 按旧地址解释。
 *  3. features 里缺键 = 可见（旧题库 JSON 不含任何新字段即可正常工作）。
 */
(function (global) {
  'use strict';

  const NAV_ITEMS = [
    { key: 'today',     label: '今日',   icon: 'today' },
    { key: 'practice',  label: '练习',   icon: 'practice' },
    { key: 'wrongbook', label: '错题本', icon: 'wrongbook' },
    { key: 'bank',      label: '题库',   icon: 'bank' }
  ];

  // 320–359：4 栏每栏 72px < 44pt 舒适区，收为 3 栏，错题本与题库进「更多」
  const NARROW_NAV = [
    { key: 'today',    label: '今日', icon: 'today' },
    { key: 'practice', label: '练习', icon: 'practice' },
    { key: 'more',     label: '更多', icon: 'more' }
  ];
  const NARROW_BREAKPOINT = 360;   // < 360px 用 3 栏

  /**
   * 练习页的模式。sessionMode 一律沿用 2.x 的名字（study/exercise/exam/category/
   * preview/practice）—— 恢复点、错题来源、备份文件都按它存，改一个字符就丢数据。
   */
  const PRACTICE_MODES = [
    { key: 'recite',  label: '背诵',       icon: 'bank',     sessionMode: 'study',    writesProgress: true,  selfJudge: true,  caliber: '逐题自评，写长期进度，有恢复点。' },
    { key: 'answer',  label: '答题',       icon: 'practice', sessionMode: 'exercise', writesProgress: true,  selfJudge: false, caliber: '客观题系统判分，主观题对照参考答案自评；答错停在本题。' },
    { key: 'bytype',  label: '按题型自测', icon: 'category', sessionMode: 'category', writesProgress: true,  selfJudge: false, caliber: '挑题型随机出题，实时判分，答对自动前进。' },
    { key: 'mock',    label: '模拟考试',   icon: 'exam',     sessionMode: 'exam',     writesProgress: true,  selfJudge: false, caliber: '过程中不判分不显示答案，可回看改答，交卷统一判分。' },
    { key: 'browse',  label: '浏览速览',   icon: 'preview',  sessionMode: 'preview',  writesProgress: false, selfJudge: false, caliber: '不判分、不写进度、没有恢复点，只读。', featureKey: 'preview' },
    { key: 'queue',   label: '闯关队列',   icon: 'grid',     sessionMode: 'practice', writesProgress: true,  selfJudge: true,  caliber: '本轮攻克只影响本轮队列顺序，不等于跨会话「已掌握」。', featureKey: 'practice' }
  ];

  /** 2.x 的 tab / hash → 3.0 的（一级导航, 练习模式） */
  const LEGACY_ROUTE = {
    home:      { tab: 'today' },
    today:     { tab: 'today' },
    study:     { tab: 'practice', mode: 'recite' },
    exercise:  { tab: 'practice', mode: 'answer' },
    category:  { tab: 'practice', mode: 'bytype' },
    exam:      { tab: 'practice', mode: 'mock' },
    preview:   { tab: 'practice', mode: 'browse' },
    practice:  { tab: 'practice', mode: 'queue' },   // 2.x 的 #/practice 是「记忆闯关」
    wrongbook: { tab: 'wrongbook' },
    bank:      { tab: 'bank' },
    data:      { tab: 'bank' }
  };

  const NAV_KEYS = NAV_ITEMS.map(n => n.key);
  const MODE_KEYS = PRACTICE_MODES.map(m => m.key);

  /** 解析 location.hash（传字符串，便于单测）。返回 {tab, mode|null} 或 null。 */
  function parseHash(hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    if (!raw) return null;
    const parts = raw.split('/');
    const head = parts[0];
    const hasSecondSeg = parts.length > 1 && parts[1] !== '';
    const modeInUrl = hasSecondSeg && MODE_KEYS.indexOf(parts[1]) >= 0 ? parts[1] : null;
    if (NAV_KEYS.indexOf(head) >= 0) {
      // 裸 #/practice 有歧义：2.x 里它是「记忆闯关」的入口地址，3.0 里它是练习页。
      // 3.0 自己生成的链接一律带模式段（见 formatHash），所以「完全没有第二段」时
      // 按旧地址解释 —— 宁可让旧书签回到它原来的页面，也不悄悄把用户送去背诵。
      // 带了第二段但不认识（#/practice/nope）不算旧地址，只退回「无模式」。
      if (head === 'practice' && !hasSecondSeg) return { tab: 'practice', mode: 'queue' };
      return { tab: head, mode: modeInUrl };
    }
    const legacy = LEGACY_ROUTE[head];
    if (!legacy) return null;
    return { tab: legacy.tab, mode: modeInUrl || legacy.mode || null };
  }

  /** 生成 hash（新格式）。练习页始终带模式段，保证 #/practice 的歧义只出现在旧链接里。 */
  function formatHash(tab, mode) {
    if (NAV_KEYS.indexOf(tab) < 0) return '';
    if (tab === 'practice') return '#/practice/' + (mode || 'recite');
    return '#/' + tab;
  }

  /**
   * 旧 features 开关键名 → 练习模式可见性（§7.4.2）。
   * 键名不改不删；「关掉记忆闯关」现在意味着「隐藏闯关队列模式」。
   * 缺键 = 可见：旧题库 JSON 不含任何新字段也必须正常工作。
   */
  function modeVisibleByFeature(features, mode) {
    if (!mode || !mode.featureKey) return true;
    const f = features && features[mode.featureKey];
    if (f == null) return true;
    if (typeof f === 'boolean') return f;
    return f.enabled !== false;
  }

  function visibleModes(features) {
    return PRACTICE_MODES.filter(m => modeVisibleByFeature(features, m));
  }

  /** 320–359 用 3 栏；其余 4 栏 */
  function navForWidth(width, features) {
    return width < NARROW_BREAKPOINT ? NARROW_NAV.slice() : NAV_ITEMS.slice();
  }
  function isNarrowWidth(width) { return width < NARROW_BREAKPOINT; }

  /** 应用栏标题：练习页报模式名，其它报入口名（iOS nav bar 报「你在哪个屏」） */
  function labelFor(tab, mode) {
    if (tab === 'practice') {
      const m = PRACTICE_MODES.find(x => x.key === mode);
      return m ? m.label : '练习';
    }
    const n = NAV_ITEMS.find(x => x.key === tab);
    return n ? n.label : 'MemoDeck';
  }

  /** 模式 → 它自己的状态机/恢复点键（永远不该被界面重命名带跑） */
  function sessionModeOf(modeKey) {
    const m = PRACTICE_MODES.find(x => x.key === modeKey);
    return m ? m.sessionMode : null;
  }
  function modeKeyOfSession(sessionMode) {
    const m = PRACTICE_MODES.find(x => x.sessionMode === sessionMode);
    return m ? m.key : null;
  }

  global.ExamNav = {
    NAV_ITEMS, NARROW_NAV, NARROW_BREAKPOINT, PRACTICE_MODES, LEGACY_ROUTE,
    parseHash, formatHash, modeVisibleByFeature, visibleModes,
    navForWidth, isNarrowWidth, labelFor, sessionModeOf, modeKeyOfSession
  };
})(typeof window !== 'undefined' ? window : globalThis);
