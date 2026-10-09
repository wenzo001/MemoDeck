/**
 * MemoDeck 3.0 · 重构兼容性与数据层规则测试
 *
 * 运行：node test/v3-compat.test.js
 * 无依赖、无框架、无构建步骤 —— 与项目「零工具链」的定位一致。
 *
 * 这一份守的是 3.0「换了界面、不能换数据」的四条硬账：
 *  1. 导航映射：8 入口收敛成 4 导航后，旧 hash、旧 session mode 键、旧 features
 *     开关键名都必须继续有效（§5.1 / §7.4.2）。
 *  2. 填空题：`|` 只在导入时拆成逐空，界面层不再出现分隔符（§4.2 决策）。
 *  3. 错题离开规则收敛为一条：任何入口答对都计连对、累计 3 次移出并告知原因；
 *     旧的「重考答对 1 次即移出」短路不许回来（§7.4.1）。
 *  4. 题型注册表：6 种题型各自注册，未注册标识走只读兜底且不崩（§4.2）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;

const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};

const JS_DIR = path.join(__dirname, '..', 'js');
// 顺序敏感：store 在 wrongbook 前；core 在 types 前（types 给 core 提供 splitBlankAnswers）
for (const f of ['core.js', 'store.js', 'leitner.js', 'wrongbook.js', 'utils.js', 'types.js', 'navigation.js', 'judge.js', 'components.js', 'progress.js', 'stats.js', 'backup.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), { filename: f });
}

const Core = global.ExamCore;
const Wrongbook = global.ExamWrongbook;
const Store = global.ExamStore;
const Types = global.ExamTypes;
const Nav = global.ExamNav;
const Judge = global.ExamJudge;
const Progress = global.ExamProgress;
const Stats = global.ExamStats;

/* ---------- 极简断言 ---------- */
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
function resetWrongbook() { Store.clearWrongbook(); }
function itemOf(id, gid) {
  return { id, gid: gid || ('P::' + id), rawType: 'single_choice', typeLabel: '单选题', question: 'q' + id, q: 'q' + id, paperId: 'P' };
}

console.log('\n导航收敛 · 旧地址与旧键名兼容（§5.1 / §7.4.2）');

test('4 个一级导航，键稳定且顺序为 今日/练习/错题本/题库', () => {
  eq(Nav.NAV_ITEMS.map(n => n.key), ['today', 'practice', 'wrongbook', 'bank']);
});

test('2.x 的 8 个入口地址逐个都有落点', () => {
  const expect = {
    '#/home':      { tab: 'today', mode: null },
    '#/study':     { tab: 'practice', mode: 'recite' },
    '#/exercise':  { tab: 'practice', mode: 'answer' },
    '#/category':  { tab: 'practice', mode: 'bytype' },
    '#/exam':      { tab: 'practice', mode: 'mock' },
    '#/preview':   { tab: 'practice', mode: 'browse' },
    '#/practice':  { tab: 'practice', mode: 'queue' },
    '#/wrongbook': { tab: 'wrongbook', mode: null }
  };
  for (const [h, want] of Object.entries(expect)) {
    const got = Nav.parseHash(h);
    assert(got, h + ' 解析为 null');
    eq([got.tab, got.mode || null], [want.tab, want.mode], h + ' 落点不对');
  }
});

test('裸 #/practice 按旧地址（闯关队列）解释，不悄悄把用户送去背诵', () => {
  eq(Nav.parseHash('#/practice').mode, 'queue');
  // 3.0 自己生成的链接一定带模式段
  eq(Nav.formatHash('practice', null), '#/practice/recite');
  eq(Nav.formatHash('practice', 'mock'), '#/practice/mock');
  eq(Nav.formatHash('today'), '#/today');
});

test('新格式 #/practice/<mode> 优先于兼容表', () => {
  eq(Nav.parseHash('#/practice/browse'), { tab: 'practice', mode: 'browse' });
  eq(Nav.parseHash('#/bank'), { tab: 'bank', mode: null });
  // 非法模式段不吞掉入口，只退回无模式
  eq(Nav.parseHash('#/practice/nope'), { tab: 'practice', mode: null });
  eq(Nav.parseHash('#/nonsense'), null);
  eq(Nav.parseHash(''), null);
});

test('练习模式的 sessionMode 沿用 2.x 原名（旧恢复点不改版就能读）', () => {
  eq(Nav.PRACTICE_MODES.map(m => m.sessionMode).sort(),
     ['category', 'exam', 'exercise', 'practice', 'preview', 'study'].sort());
  eq(Nav.sessionModeOf('recite'), 'study');
  eq(Nav.sessionModeOf('answer'), 'exercise');
  eq(Nav.sessionModeOf('mock'), 'exam');
  eq(Nav.modeKeyOfSession('study'), 'recite');
  eq(Nav.modeKeyOfSession('exam'), 'mock');
});

test('旧 features 键名不改不删：缺键=可见，enabled:false 才隐藏对应模式', () => {
  const queue = Nav.PRACTICE_MODES.find(m => m.key === 'queue');
  const browse = Nav.PRACTICE_MODES.find(m => m.key === 'browse');
  // 旧题库 JSON 不含任何新字段 → 全部可见
  eq(Nav.visibleModes({}).length, 6);
  eq(Nav.visibleModes(undefined).length, 6);
  // 关掉「记忆闯关」→ 隐藏闯关队列；其它不受影响
  eq(Nav.visibleModes({ practice: { enabled: false } }).length, 5);
  assert(!Nav.visibleModes({ practice: { enabled: false } }).some(m => m.key === 'queue'), '关掉 practice 后队列仍在');
  assert(!Nav.visibleModes({ preview: { enabled: false } }).some(m => m.key === 'browse'), '关掉 preview 后浏览仍在');
  assert(Nav.modeVisibleByFeature({}, queue), '缺键应视为可见');
  assert(Nav.modeVisibleByFeature({ practice: true }, queue) === true, '布尔 true 应可见');
  assert(Nav.modeVisibleByFeature({ practice: false }, queue) === false, '布尔 false 应隐藏');
});

test('320–359 收为 3 栏，360 起恢复 4 栏直达', () => {
  eq(Nav.navForWidth(320).map(n => n.key), ['today', 'practice', 'more']);
  eq(Nav.navForWidth(359).length, 3);
  eq(Nav.navForWidth(360).map(n => n.key), ['today', 'practice', 'wrongbook', 'bank']);
  eq(Nav.isNarrowWidth(359), true);
  eq(Nav.isNarrowWidth(360), false);
});

test('应用栏标题：练习页报模式名，其它报入口名', () => {
  eq(Nav.labelFor('practice', 'answer'), '答题');
  eq(Nav.labelFor('practice', 'recite'), '背诵');
  eq(Nav.labelFor('today'), '今日');
  eq(Nav.labelFor('wrongbook'), '错题本');
  eq(Nav.labelFor('bank'), '题库');
});

console.log('\n填空题 · 逐空答案与 | 只在导入时拆分（§4.2）');

test('splitBlankAnswers 接受半角与全角分隔符，丢空段', () => {
  eq(Types.splitBlankAnswers('鸦片|1840'), ['鸦片', '1840']);
  eq(Types.splitBlankAnswers('鸦片｜1840'), ['鸦片', '1840']);
  eq(Types.splitBlankAnswers(' 甲 | 乙 | 丙 '), ['甲', '乙', '丙']);
  eq(Types.splitBlankAnswers('只有一个'), ['只有一个']);
  eq(Types.splitBlankAnswers(''), []);
  eq(Types.splitBlankAnswers(null), []);
  eq(Types.splitBlankAnswers('a||b'), ['a', 'b']);
});

test('normalizeQuestion：老写法 answer="鸦片|1840" 在导入时被拆成逐空 blanks', () => {
  const q = Core.normalizeQuestion({ id: 1, type: 'fill_blank', question: '____和____。', answer: '鸦片|1840' });
  eq(q.blanks, [{ index: 1, answer: '鸦片' }, { index: 2, answer: '1840' }]);
});

test('normalizeQuestion：显式 blanks 数组优先，不被 answer 覆盖', () => {
  const q = Core.normalizeQuestion({ id: 1, type: 'fill_blank', question: 'x', answer: '不该用', blanks: [{ index: 1, answer: '甲' }] });
  eq(q.blanks, [{ index: 1, answer: '甲' }]);
});

test('专项题与填空题走同一条归一化（答案结构完全一致）', () => {
  const a = Core.normalizeQuestion({ id: 1, type: 'fill_blank', question: 'q', answer: '甲|乙' });
  const b = Core.normalizeQuestion({ id: 2, type: 'special_fill_blank', question: 'q', answer: '甲|乙' });
  eq(a.blanks, b.blanks);
});

test('countBlankSlots 按题干的 ____ 数空位（≥2 个下划线算一个）', () => {
  eq(Types.countBlankSlots('a____b____c'), 2);
  eq(Types.countBlankSlots('a__b__c__'), 3);
  eq(Types.countBlankSlots('没有空'), 0);
});

test('questionHtml 把 ____ 变成占位块，且转义 HTML（题库内容不可信）', () => {
  const html = Types.questionHtml('开头是____。', 1);
  assert(html.indexOf('md-blank-slot is-filled') >= 0, '已填空位没标记');
  const evil = Types.questionHtml('<img src=x onerror=alert(1)>____', 0);
  assert(evil.indexOf('<img') === -1, '题干里的标签没被转义: ' + evil);
  assert(evil.indexOf('&lt;img') >= 0, '期望转义为 &lt;img');
});

console.log('\n题型注册表 · 6 种各自注册，未注册走只读兜底（§4.2）');

test('六种题型全部注册，判分归属符合 §4.2 表', () => {
  eq(Object.keys(Types.TYPE_PRESENTERS).sort(),
     ['essay', 'fill_blank', 'multi_choice', 'single_choice', 'special_fill_blank', 'true_false']);
  eq(Types.TYPE_PRESENTERS.true_false.judge, 'auto');
  eq(Types.TYPE_PRESENTERS.single_choice.judge, 'auto');
  eq(Types.TYPE_PRESENTERS.multi_choice.judge, 'auto');
  eq(Types.TYPE_PRESENTERS.fill_blank.judge, 'self');
  eq(Types.TYPE_PRESENTERS.essay.judge, 'self');
  eq(Types.TYPE_PRESENTERS.special_fill_blank.judge, 'self');
  eq(Types.isAutoJudged('multi_choice'), true);
  eq(Types.isAutoJudged('essay'), false);
});

test('专项题复用填空控件，不另写一套实现', () => {
  eq(Types.presenterOf('special_fill_blank').control, Types.presenterOf('fill_blank').control);
  eq(Types.presenterOf('special_fill_blank').control, 'blank-input');
});

test('未注册标识不判分、走 DefaultRenderer，且取不到 presenter 不抛错', () => {
  eq(Types.isRegistered('matching'), false);
  eq(Types.presenterOf('matching'), null);
  eq(Types.isAutoJudged('matching'), false);
  eq(Types.TYPE_PRESENTERS.matching, undefined);
});

test('七种题型控件都已注册成 Vue 组件', () => {
  ['question-text', 'tf-input', 'choice-input', 'blank-input', 'essay-input', 'default-renderer', 'q-renderer']
    .forEach(k => assert(Types.components[k], '缺组件 ' + k));
  ['caliber-note', 'status-chip', 'triplet', 'judge-result', 'answer-view', 'resume-card', 'question-history']
    .forEach(k => assert(global.ExamComponents.components[k], '缺共享组件 ' + k));
});

console.log('\n错题离开规则 · 收敛为一条（§7.4.1）');

test('任何入口答对都计连对：creditCorrectByGid 推进状态机', () => {
  resetWrongbook();
  const it = itemOf(1);
  Wrongbook.add(it, 'study', null, false);
  eq(Wrongbook.list()[0].status, 'new');
  const r1 = Wrongbook.creditCorrectByGid(it.gid);
  eq([r1.recorded, r1.removed, r1.streak], [true, false, 1]);
  const r2 = Wrongbook.creditCorrectByGid(it.gid);
  eq([r2.removed, r2.streak, Wrongbook.list()[0].status], [false, 2, 'weak']);
  eq(Wrongbook.list()[0].status, 'weak', '连对 2 次应为「模糊」(weak)');
});

test('累计连对 3 次才移出，并且带出原因文案', () => {
  resetWrongbook();
  const it = itemOf(2);
  Wrongbook.add(it, 'exam', null, false);
  Wrongbook.creditCorrectByGid(it.gid);
  Wrongbook.creditCorrectByGid(it.gid);
  const r3 = Wrongbook.creditCorrectByGid(it.gid);
  eq(r3.removed, true);
  assert(/3 次/.test(r3.reason), '移出原因必须写明次数，实际: ' + r3.reason);
  eq(Wrongbook.list().length, 0);
});

test('答对 1 次绝不移出（旧的「重考短路」不许回来）', () => {
  resetWrongbook();
  const it = itemOf(3);
  Wrongbook.add(it, 'exam', null, false);
  const r = Wrongbook.creditCorrectByGid(it.gid);
  eq(r.removed, false, '答对 1 次就移出 = 旧短路复活');
  eq(Wrongbook.list().length, 1);
});

test('中途答错把连对归零（移出必须连续 3 次）', () => {
  resetWrongbook();
  const it = itemOf(4);
  Wrongbook.add(it, 'study', null, false);
  Wrongbook.creditCorrectByGid(it.gid);
  Wrongbook.creditCorrectByGid(it.gid);
  const e = Wrongbook.list()[0];
  Wrongbook.markWrong(e.id);
  eq(Wrongbook.list()[0].correctStreak, 0);
  eq(Wrongbook.list()[0].status, 'new');
  // 归零后再对 3 次才移出
  eq(Wrongbook.creditCorrectByGid(it.gid).removed, false);
  eq(Wrongbook.creditCorrectByGid(it.gid).removed, false);
  eq(Wrongbook.creditCorrectByGid(it.gid).removed, true);
});

test('不在错题本里的题答对 = no-op，绝不凭空造一条错题记录', () => {
  resetWrongbook();
  const r = Wrongbook.creditCorrectByGid('NOPE::1');
  eq(r, { recorded: false, removed: false, reason: '', streak: 0 });
  eq(Wrongbook.list().length, 0);
  eq(Wrongbook.creditCorrectByGid(null).recorded, false);
});

test('移出留痕：自动移出与手动标记都记原因（已攻克可数）', () => {
  resetWrongbook();
  const a = itemOf(5), b = itemOf(6);
  Wrongbook.add(a, 'study', null, false);
  Wrongbook.add(b, 'exercise', null, false);
  Wrongbook.creditCorrectByGid(a.gid); Wrongbook.creditCorrectByGid(a.gid); Wrongbook.creditCorrectByGid(a.gid);
  // markCleared 收的是「错题本条目 id」（genId 生成的字符串），不是题目 id
  const bEntry = Wrongbook.list().find(e => e.gid === b.gid);
  assert(bEntry, '没找到 b 的错题条目');
  Wrongbook.markCleared(bEntry.id);
  const h = Wrongbook.clearedHistory();
  eq(h.length, 2);
  assert(h.some(x => /连对 3 次/.test(x.reason)), '缺自动移出的留痕');
  assert(h.some(x => /手动标记/.test(x.reason)), '缺手动标记的留痕');
  eq(Wrongbook.countByStatus().cleared, 2);
});

test('手动删除也留痕，原因与自动移出区分开', () => {
  resetWrongbook();
  const it = itemOf(7);
  Wrongbook.add(it, 'exam', null, false);
  const id = Wrongbook.list()[0].id;
  Wrongbook.remove(id, '手动删除');
  eq(Wrongbook.list().length, 0);
  eq(Wrongbook.clearedHistory()[0].reason, '手动删除');
});

test('旧数据没有 history 字段也能读（不清空、不报错）', () => {
  Store.writeWrongbook({ entries: [{ id: 'x', gid: 'P::9', item: itemOf(9), status: 'new', wrongCount: 1, correctStreak: 0 }] });
  eq(Wrongbook.list().length, 1);
  eq(Wrongbook.clearedHistory(), []);
  eq(Wrongbook.countByStatus().cleared, 0);
  // 一次移出后 history 被现场补出来
  Wrongbook.creditCorrectByGid('P::9');
  eq(Wrongbook.countByStatus().cleared, 0);
  Wrongbook.creditCorrectByGid('P::9');
  Wrongbook.creditCorrectByGid('P::9');
  eq(Wrongbook.countByStatus().cleared, 1);
});

console.log('\n命名消歧与口径（§7.3 / §7.2）');

test('记忆四档互斥且相加=总题数；需复习=review 档，与错题本的模糊不是一个数', () => {
  const gids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const map = {
    a: { status: 'new', attempts: 0, correct: 0, wrong: 0, streak: 0, nextReviewAt: null },
    b: { status: 'learning', attempts: 1, correct: 0, wrong: 1, streak: 0, nextReviewAt: null },
    c: { status: 'review', attempts: 3, correct: 3, wrong: 0, streak: 3, nextReviewAt: '2099-01-01T00:00:00.000Z' },
    d: { status: 'mastered', attempts: 5, correct: 5, wrong: 0, streak: 5, nextReviewAt: '2099-01-01T00:00:00.000Z' },
    e: { status: 'review', attempts: 2, correct: 2, wrong: 0, streak: 3, nextReviewAt: '2000-01-01T00:00:00.000Z' },
    f: { status: 'learning', attempts: 1, correct: 1, wrong: 0, streak: 1, nextReviewAt: '2000-01-01T00:00:00.000Z' }
  };
  const d = Stats.buildDashboard({ allGids: gids, progressMap: map, wrongbookEntries: [] });
  eq(d.new + d.learning + d.needReview + d.mastered, d.total, '四档相加必须等于总题数');
  eq([d.new, d.learning, d.needReview, d.mastered], [1, 2, 2, 1]);
  // 到期是另一个维度：c/d 未到期，其余到期
  eq(d.due, 4);
});

test('到期题按记忆档拆开（界面写「含」而不是并列相加）', () => {
  const gids = ['a', 'b', 'c', 'd'];
  const map = {
    b: { status: 'learning', attempts: 1, correct: 0, wrong: 1, streak: 0, nextReviewAt: '2000-01-01T00:00:00.000Z' },
    c: { status: 'review', attempts: 3, correct: 3, wrong: 0, streak: 3, nextReviewAt: '2000-01-01T00:00:00.000Z' },
    d: { status: 'mastered', attempts: 5, correct: 5, wrong: 0, streak: 5, nextReviewAt: '2000-01-01T00:00:00.000Z' }
  };
  const db = Stats.dueBreakdown(gids, map, '2026-01-01T00:00:00.000Z');
  eq(db, { fresh: 1, learning: 1, review: 1, total: 3 });
});

test('正确率分母 = 已判分题数（不含待自评与未作答）——口径由数据层给数', () => {
  // 这条锁住 examGradedCount 的语义来源：pass+fail，不含 pending/blank
  const pass = 32, fail = 10, pending = 6, blank = 2;
  const graded = pass + fail;
  eq(graded, 42);
  eq(Math.round(pass / graded * 100), 76);
  assert(pass / (graded + pending + blank) !== 0.76, '若把待自评与未作答算进分母，正确率会被系统性压低');
});

test('模板接线：词表选择器与纯展示组件的 props 不许漏传', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  /* status-chip 的 set 决定用哪张词表。只查「有没有 set=」会被两种错法蒙过去：
     删掉属性、或把状态值当词表名传进去（:set="e.status"）—— 后者正是这次的真缺陷，
     它静默回落到记忆表，new→「新题」、weak→「需复习」。所以这里要**认出词表名本身**。 */
  const chips = [...html.matchAll(/<status-chip\b[^>]*>/g)].map(m => m[0]);
  assert(chips.length >= 2, '模板里找不到 status-chip 用法，这条门禁在扫空气');
  chips.forEach(tag => {
    const m = tag.match(/\sset="([^"]*)"/);
    assert(m, 'status-chip 没写 set：' + tag);
    assert(/^(memory|wrong|session)$/.test(m[1]),
      'status-chip 的 set 必须是词表名 memory|wrong|session，实际是「' + m[1] + '」：' + tag);
  });
  // 「这道题的历史」是纯展示组件：entry/wrong 漏了不报错，只会永远显示「学过 0 次」。
  // 必须是绑定（:entry），写字面量等于把组件钉死在一个空值上。
  const hist = [...html.matchAll(/<question-history\b[^>]*>/g)].map(m => m[0]);
  assert(hist.length >= 2, '模板里找不到 question-history 用法');
  hist.forEach(tag => {
    assert(/:entry=/.test(tag), 'question-history 没绑定 entry：' + tag);
    assert(/:wrong=/.test(tag), 'question-history 没绑定 wrong：' + tag);
  });
  // 错题本必须同时有「重练」与「重考」两个发起方式（§5.1）：
  // 重练的模板与函数都在、却没有任何调用方 —— 那等于 UI 有卡片没有门
  assert(/startWrongPractice\(/.test(html), '错题重练入口没有接线（§5.1 要求两种发起方式）');
  assert(/startWrongExam\(/.test(html), '错题重考入口没有接线');
});

console.log('\n判分口径唯一（§4.3）· 直接打在被使用的实现上（js/judge.js）');

test('判断：未作答判错不送分，尤其标准答案为 false 时', () => {
  eq(Judge.isObjective('true_false'), true);
  eq(Judge.judge({ rawType: 'true_false', answer: false }, null), false, '未作答 + 标准答案 false 被白送一分');
  eq(Judge.judge({ rawType: 'true_false', answer: false }, 'false'), true);
  eq(Judge.judge({ rawType: 'true_false', answer: false }, 'true'), false);
  eq(Judge.judge({ rawType: 'true_false', answer: true }, 'true'), true);
  eq(Judge.judge({ rawType: 'true_false', answer: true }, 'false'), false);
  eq(Judge.judge({ rawType: 'true_false', answer: true }, ''), false);
});

test('单选：字母全等才对；未作答判错；不做大小写归一（保持 2.x 口径）', () => {
  eq(Judge.judge({ rawType: 'single_choice', answer: 'C' }, 'C'), true);
  eq(Judge.judge({ rawType: 'single_choice', answer: 'C' }, 'B'), false);
  eq(Judge.judge({ rawType: 'single_choice', answer: 'C' }, null), false);
  eq(Judge.judge({ rawType: 'single_choice', answer: 'C' }, ''), false);
  eq(Judge.judge({ rawType: 'single_choice', answer: 'C' }, 'c'), false, '口径变了：2.x 是字母全等');
});

test('多选：排序后全等才判对，漏选/多选/错选都算整题错（无部分给分）', () => {
  const q = { rawType: 'multi_choice', answer: ['B', 'C', 'D'] };
  eq(Judge.judge(q, null, ['D', 'C', 'B']), true, '乱序全等应判对');
  eq(Judge.judge(q, null, ['B', 'C']), false, '漏选应判错');
  eq(Judge.judge(q, null, ['A', 'B', 'C', 'D']), false, '多选应判错');
  eq(Judge.judge(q, null, ['A']), false, '错选应判错');
  eq(Judge.judge(q, null, []), false, '未作答应判错');
  eq(Judge.judge(q, null, undefined), false, '未作答(未传)应判错');
});

test('答案形状不合约定时按空集处理：永远判错但不崩溃', () => {
  const weird = { rawType: 'multi_choice', answer: 'B、C' };   // 本该是数组
  eq(Judge.judge(weird, null, ['B', 'C']), false);
  eq(Judge.judge(weird, null, []), false);
  eq(Judge.stdLetters(weird), []);
  eq(Judge.judge(null, null, null), false);
  eq(Judge.judge({ rawType: 'single_choice' }, 'A'), false);   // answer 缺失
});

test('填空/问答/专项没有判分逻辑，一律用户自评', () => {
  ['fill_blank', 'essay', 'special_fill_blank', 'matching'].forEach(t => {
    eq(Judge.isObjective(t), false, t + ' 不该由系统判分');
    eq(Judge.judge({ rawType: t, answer: '甲' }, '甲'), false, t + ' 不该被系统判对');
  });
});

test('判断题的「正确答案项」取自判分模块，且与判分结论恒等', () => {
  // 界面把哪一项涂成绿色，就必须是 judge 认作正确的那一项。
  // 曾经 stdKeysOf 不认 true_false，于是正确答案是「正确」时用户选了「正确」，
  // 横幅说答对、按钮却被涂成红色（§4.4 把「正确」和「你选」两态搞反）。
  [[true, 'true'], [true, 'false'], [true, null],
   [false, 'true'], [false, 'false'], [false, null]].forEach(([ans, pick]) => {
    const item = { rawType: 'true_false', answer: ans };
    const std = Judge.stdTfKeys(item);
    eq(std.length, 1, '判断题只有一个标准项');
    eq(Judge.judge(item, pick), std[0] === pick,
       `answer=${ans} pick=${pick} 时「标注的正确项」与「判分结论」不一致`);
  });
  eq(Judge.stdTfKeys(null), []);
});

test('题型分发器把作答模型交给对应控件（判断题曾拿到 null）', () => {
  const QR = Types.components['q-renderer'];
  const modelFor = (rawType, extra) => {
    const ctx = Object.assign({
      item: { rawType }, presenter: Types.presenterOf(rawType),
      choice: 'true', multi: ['A', 'B'], blanks: ['甲'], essay: '一段话'
    }, extra || {});
    ctx.control = QR.computed.control.call(ctx);
    return QR.computed.model.call(ctx);
  };
  // 判断题：exam 页不传 state-of，选中态完全靠 model-value 送进去
  eq(modelFor('true_false'), 'true');
  eq(modelFor('single_choice'), 'true');
  eq(modelFor('multi_choice'), ['A', 'B']);
  eq(modelFor('fill_blank'), ['甲']);
  eq(modelFor('special_fill_blank'), ['甲']);
  eq(modelFor('essay'), '一段话');
  // 未注册题型没有作答控件，模型一律 null（只读兜底）
  eq(modelFor('matching'), null);
});

test('界面层不再自带第二套判分实现', () => {
  const src = fs.readFileSync(path.join(JS_DIR, 'app.js'), 'utf8');
  const body = src.slice(src.indexOf('function judgeObjective'), src.indexOf('function judgeObjective') + 240);
  assert(/Judge\.judge\(/.test(body), 'app.js 的 judgeObjective 没转发到 ExamJudge');
  assert(!/rawType === 'true_false'/.test(body), 'app.js 里还留着第二套判分分支');
  /* 真正的反重复门禁：判分公式的两条签名只允许出现在 js/judge.js 里。
     任何界面/模块再写一遍，这里就会红。 */
  const SIGNATURES = [
    /\(choice === 'true'\)\s*===/,          // 判断：所选布尔与标准一致
    /join\(','\)\s*===\s*\S+join\(','\)/    // 多选：两个排序后的集合比全等
  ];
  const offenders = [];
  fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js') && f !== 'judge.js').forEach(f => {
    const s = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    if (SIGNATURES.some(re => re.test(s))) offenders.push(f);
  });
  eq(offenders, [], '这些文件里出现了第二套判分实现');
  // 反向确认这条门禁不是空扫：judge.js 自己必须两条都命中
  const judgeSrc = fs.readFileSync(path.join(JS_DIR, 'judge.js'), 'utf8');
  assert(SIGNATURES.every(re => re.test(judgeSrc)), 'judge.js 应当含这两处判分签名（否则本条门禁在扫空气）');
});

console.log('\n备份与旧数据 · 2.x 备份不改版就能导入 3.0');

test('导入 2.0 备份：数据键原样落地，并报告旧口径提示', () => {
  const Backup = global.ExamBackup;
  const v2 = {
    memodeckVersion: '2.0', schema: 1, exportedAt: '2026-09-15T10:00:00.000Z',
    storage: {
      'examProgress:v1': { version: 1, progress: { 'P::1': { status: 'review', attempts: 3, correct: 3, wrong: 0, streak: 3, nextReviewAt: null } } },
      'examWrongbook:v1': { entries: [{ id: 'e1', gid: 'P::2', item: itemOf(2), status: 'new', wrongCount: 1, correctStreak: 0 }] },
      'examSession:v1': { version: 1, resume: { mode: 'study', bankId: 'B', queueGids: ['P::1'], currentIndex: 4 } },
      'examSettings:v1': { version: 1, dailyTarget: 30, defaultMode: 'study', enableDailyReminder: false }
    }
  };
  const norm = Backup.normalizeBackup(v2);
  eq(norm.from, '2.0');
  assert(norm.notes.some(n => /可直接读取/.test(n)), '旧版本备份应说明结构未变更');
  assert(norm.notes.some(n => /移出留痕/.test(n)), '应提示旧错题本没有 history');
  assert(norm.notes.some(n => /单槽/.test(n)), '应提示旧恢复点是单槽格式');
  eq(Backup.validate(v2), null, '2.0 备份不该被判为不合法');
});

test('备份的导出版本号读 config 的 BACKUP_VERSION', () => {
  const cfg = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8'), { window: cfg });
  eq(cfg.EXAM_CONFIG.BACKUP_VERSION, '3.0', 'BACKUP_VERSION 是备份格式版本，3.x 内不再变');
  // viewVersion 必须**不动**：题库数据格式没变，这是「旧题库 JSON 无需重导」的前提
  eq(cfg.EXAM_CONFIG.VIEW_VERSION, '1.0.0', 'viewVersion 不该随应用版本一起动');
  /* APP_VERSION 不钉具体数字：它每次发版都变，钉死只会让每次发版都要改测试
     （那等于用测试去追一个会动的常量）。这里钉的是**形状 + 与三处一致性的前提**：
     必须是 x.y.z，且主版本与 BACKUP_VERSION 同代。三处一致由 CI 单独把关。 */
  assert(/^\d+\.\d+\.\d+$/.test(cfg.EXAM_CONFIG.APP_VERSION),
    'APP_VERSION 必须是 x.y.z，实际 ' + cfg.EXAM_CONFIG.APP_VERSION);
  eq(cfg.EXAM_CONFIG.APP_VERSION.split('.')[0], cfg.EXAM_CONFIG.BACKUP_VERSION.split('.')[0],
    'APP_VERSION 与 BACKUP_VERSION 的主版本必须同代');
});

test('内置兜底题库与示例数据仍是合法 viewVersion 1.0.0（冷启动可直接练）', () => {
  const db = fs.readFileSync(path.join(__dirname, '..', 'default-bank.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(db, sandbox);
  const bank = sandbox.window.DEFAULT_BANK;
  assert(bank, 'default-bank.js 没导出 DEFAULT_BANK');
  eq(bank.viewVersion, '1.0.0');
  const nb = Core.normalizeBank(bank);
  const items = Core.buildItems(nb, nb.papers[0].id);
  assert(items.length > 0, '兜底题库解析后为空');
  // 六种题型里兜底题库至少要能出一种可练的题（冷启动第一次就能刷完一轮）
  assert(items.every(it => it.gid && it.paperId), '兜底题库条目缺 gid/paperId，进度与错题本会串');
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
