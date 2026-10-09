/**
 * MemoDeck · 错题本 v2
 * 挂载到 window.ExamWrongbook
 *
 * v1 → v2 升级（保持所有旧 API 签名不变）：
 *   旧字段：id / source / item / userAnswer / correct / addedAt
 *   新增字段：
 *     gid            跨卷唯一标识（item.paperId + '::' + item.id）
 *     firstWrongAt   首次进错题本时间
 *     lastWrongAt    最近一次答错
 *     wrongCount     累计错误次数
 *     lastRightAt    最近一次答对
 *     correctStreak  连续答对次数（答对+1，答错归零）
 *     status         'new' | 'learning' | 'weak' | 'mastered'
 *                    new      → 首次/最近答错
 *                    learning → 错 ≥2 次
 *                    weak     → 连续答对 ≥2 次
 *                    mastered → 连续答对 ≥3 次（自动移除）
 *
 * 去重优先级：gid（新）> id + rawType（旧，兼容）
 */
(function (global) {
  'use strict';

  const Store = global.ExamStore;

  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // 从 item 提取 gid（如果有），否则返回 null
  function extractGid(item) {
    if (!item) return null;
    if (item.gid) return item.gid;
    // 兼容旧 buildItems 没 gid 的情况 —— 用 paperId + '::' + id 现场拼
    if (item.paperId !== undefined && item.id !== undefined) return item.paperId + '::' + item.id;
    return null;
  }

  // 给 v1 entry 补 v2 字段（幂等，可重复执行）
  function upgradeEntry(e) {
    if (!e) return e;
    if (e._upgradedV2) return e;
    e.gid = extractGid(e.item) || null;
    e.firstWrongAt = e.firstWrongAt || e.addedAt || new Date().toISOString();
    e.lastWrongAt = e.lastWrongAt || e.addedAt || new Date().toISOString();
    e.wrongCount = (typeof e.wrongCount === 'number') ? e.wrongCount : 1;
    e.lastRightAt = e.lastRightAt || null;
    e.correctStreak = (typeof e.correctStreak === 'number') ? e.correctStreak : 0;
    e.status = e.status || 'new';
    e._upgradedV2 = true;
    return e;
  }

  function findEntry(wb, item) {
    const gid = extractGid(item);
    if (gid) {
      // 新数据：有 gid → 精确判重（多卷同 id 也不会误合并）
      return wb.entries.find(e => e.gid === gid) || null;
    }
    // 极旧数据：连 paperId 都没有 → 回退到 id + rawType
    return wb.entries.find(e => e.item && e.item.id === item.id && e.item.rawType === item.rawType) || null;
  }

  /**
   * 加入错题本
   * 保持旧签名：add(item, source, userAnswer, correct) → boolean
   * v2 升级：自动补 gid / v2 字段；已存在条目刷新来源/作答 + wrongCount++ + status 回到 new
   */
  function add(item, source, userAnswer, correct) {
    if (!item || item.id === undefined) return false;
    const wb = Store.readWrongbook();
    upgradeAll(wb);

    const exist = findEntry(wb, item);
    if (exist) {
      // 已存在：刷新来源 + 作答 + 错误计数 + 状态机回退
      if (source && exist.source !== source) exist.source = source;
      if (userAnswer !== undefined && userAnswer !== null) exist.userAnswer = userAnswer;
      if (correct !== undefined && correct !== null) exist.correct = correct;
      exist.lastWrongAt = new Date().toISOString();
      exist.wrongCount = (exist.wrongCount || 0) + 1;
      exist.correctStreak = 0;       // 答错 → streak 归零
      exist.status = 'new';          // 答错 → 状态回退
      Store.writeWrongbook(wb);
      return false;
    }

    // 全新条目
    const now = new Date().toISOString();
    const entry = {
      id: genId(),
      gid: extractGid(item),
      source: source,
      item: item,
      userAnswer: userAnswer ?? null,
      correct: correct ?? null,
      addedAt: now,
      firstWrongAt: now,
      lastWrongAt: now,
      wrongCount: 1,
      lastRightAt: null,
      correctStreak: 0,
      status: 'new',
      _upgradedV2: true
    };
    wb.entries.push(entry);
    Store.writeWrongbook(wb);
    return true;
  }

  function list() {
    const wb = Store.readWrongbook();
    upgradeAll(wb);
    return wb.entries.slice(); // 返回副本防止外部误改
  }

  function upgradeAll(wb) {
    if (!wb || !wb.entries) return;
    let changed = false;
    wb.entries.forEach(e => { const u = upgradeEntry(e); if (!u._upgradedV2) changed = true; });
    if (changed) Store.writeWrongbook(wb);
  }

  function remove(id, reason) {
    const wb = Store.readWrongbook();
    const gone = wb.entries.filter(e => e.id === id);
    wb.entries = wb.entries.filter(e => e.id !== id);
    // 3.0：移出必须留痕并写明原因（DESIGN.md §7.4.1「移出时必须告知原因」）。
    // 旧数据没有 history 字段 → 现场补一个空数组，不升 key、不改 v1 结构。
    if (gone.length) { pushHistory(wb, gone[0], reason || '手动删除'); }
    Store.writeWrongbook(wb);
  }

  /** 3.0 新增：移出留痕。老版本存储里没有 history 键，读取时按空数组处理。 */
  function pushHistory(wb, entry, reason) {
    if (!Array.isArray(wb.history)) wb.history = [];
    wb.history.push({
      gid: entry.gid || null,
      itemId: entry.item ? entry.item.id : null,
      at: new Date().toISOString(),
      reason: reason || '手动删除'
    });
    return wb.history;
  }

  // 按 item 移除：内部优先用 gid
  function removeByItem(item, reason) {
    if (!item) return;
    const wb = Store.readWrongbook();
    const gid = extractGid(item);
    let removed = null;
    wb.entries = wb.entries.filter(e => {
      const match = gid ? e.gid === gid : (e.item && e.item.id === item.id && e.item.rawType === item.rawType);
      if (match && !removed) { removed = e; return false; }
      return true;
    });
    if (removed) { pushHistory(wb, removed, reason || '手动删除'); Store.writeWrongbook(wb); }
  }

  function clear(source) {
    const wb = Store.readWrongbook();
    wb.entries = source ? wb.entries.filter(e => e.source !== source) : [];
    Store.writeWrongbook(wb);
  }

  function countBySource() {
    const m = { practice: 0, preview: 0, exam: 0, study: 0, exercise: 0 };
    list().forEach(e => { if (Object.prototype.hasOwnProperty.call(m, e.source)) m[e.source]++; });
    return m;
  }

  /**
   * 答对了 —— 推进状态机。
   *
   * 3.0（DESIGN.md §7.4.1 已决策）：**错题离开只有一条规则**——
   * 任何入口答对都计连对，累计连对 3 次自动移出，并且必须告知原因。
   * 2.x 的三条并行规则（重练连对 3 次移出 / 重考答对 1 次即移出 / 其它入口答对不计次）
   * 里那条「答对 1 次就短路移出」的分支已经从调用侧删除（见 js/app.js finishCatAnswer）。
   *
   * @returns {{ entry: object|null, removed: boolean, reason: string, streak: number }}
   */
  function markCorrect(entryOrId) {
    const wb = Store.readWrongbook();
    upgradeAll(wb);
    let entry = typeof entryOrId === 'string'
      ? wb.entries.find(e => e.id === entryOrId)
      : wb.entries.find(e => e.id === entryOrId.id);
    if (!entry) return { entry: null, removed: false, reason: '', streak: 0 };

    entry.lastRightAt = new Date().toISOString();
    entry.correctStreak = (entry.correctStreak || 0) + 1;

    // 状态机推进
    if (entry.correctStreak >= 3) {
      // 累计连对 3 次 → 已攻克 → 自动移出并留痕
      entry.status = 'mastered';
      wb.entries = wb.entries.filter(e => e.id !== entry.id);
      pushHistory(wb, entry, '连对 3 次自动移出');
      Store.writeWrongbook(wb);
      return { entry, removed: true, reason: '连对 3 次自动移出', streak: entry.correctStreak };
    } else if (entry.correctStreak >= 2) {
      entry.status = 'weak';        // 错题本侧叫「模糊」，不叫「待复习」（§7.3）
    } else {
      entry.status = entry.wrongCount >= 2 ? 'learning' : 'new';
    }
    Store.writeWrongbook(wb);
    return { entry, removed: false, reason: '', streak: entry.correctStreak };
  }

  /**
   * 3.0 新增：按 gid 计连对——「任何入口答对都计次」的**唯一**入口。
   * 不在错题本里则什么都不做（返回 recorded:false），绝不因为答对了一道
   * 本来没错的题而凭空造一条错题记录。
   * @param {string} gid
   * @returns {{ recorded: boolean, removed: boolean, reason: string, streak: number }}
   */
  function creditCorrectByGid(gid) {
    if (!gid) return { recorded: false, removed: false, reason: '', streak: 0 };
    const wb = Store.readWrongbook();
    upgradeAll(wb);
    const entry = wb.entries.find(e => e.gid === gid);
    if (!entry) return { recorded: false, removed: false, reason: '', streak: 0 };
    const r = markCorrect(entry);
    return { recorded: true, removed: r.removed, reason: r.reason, streak: r.streak };
  }

  /**
   * 3.0 新增（§7.5 建议补齐）：手动把一条错题标为已攻克。
   * 与「连对 3 次自动移出」走同一个留痕通道，原因写「手动标记已攻克」，
   * 这样用户永远能区分「系统判定我掌握了」和「我自己说的」。
   */
  function markCleared(entryOrId) {
    const wb = Store.readWrongbook();
    upgradeAll(wb);
    const id = typeof entryOrId === 'string' ? entryOrId : (entryOrId && entryOrId.id);
    const entry = wb.entries.find(e => e.id === id);
    if (!entry) return null;
    entry.status = 'mastered';
    entry.lastRightAt = new Date().toISOString();
    wb.entries = wb.entries.filter(e => e.id !== id);
    pushHistory(wb, entry, '手动标记已攻克');
    Store.writeWrongbook(wb);
    return entry;
  }

  // 状态机：手动标记 entry 答错（比如错题练习中又答错）
  function markWrong(entryOrId) {
    const wb = Store.readWrongbook();
    upgradeAll(wb);
    let entry = typeof entryOrId === 'string'
      ? wb.entries.find(e => e.id === entryOrId)
      : wb.entries.find(e => e.id === entryOrId.id);
    if (!entry) return null;
    entry.lastWrongAt = new Date().toISOString();
    entry.wrongCount = (entry.wrongCount || 0) + 1;
    entry.correctStreak = 0;
    entry.status = 'new';
    Store.writeWrongbook(wb);
    return entry;
  }

  /**
   * 3.0 新增：按 gid 计答错——「任何入口答错都进错题本」的唯一入口。
   * 与 creditCorrectByGid 成对：不在本里就新建，在本里就回退状态机。
   */
  function creditWrongByGid(gid, item, source, userAnswer) {
    if (!item) return false;
    return add(item, source, userAnswer, false);
  }

  // 按 status 分组计数
  function countByStatus() {
    // 3.0：cleared = 历史累计已攻克条数（含自动移出与手动标记）。
    // 它与本表其它三档**不是同一集合**：其它三档是「当前还在错题本里」的题，
    // 已攻克已经离开错题本，所以四个数相加不等于错题总数（界面上必须这样写明）。
    const m = { new: 0, learning: 0, weak: 0, mastered: 0, cleared: 0 };
    list().forEach(e => { if (m[e.status] !== undefined) m[e.status]++; else m.new++; });
    const wb = Store.readWrongbook();
    m.cleared = Array.isArray(wb.history) ? wb.history.length : 0;
    return m;
  }

  /** 3.0 新增：移出留痕（供错题本页与单测读取） */
  function clearedHistory() {
    const wb = Store.readWrongbook();
    return Array.isArray(wb.history) ? wb.history.slice() : [];
  }

  global.ExamWrongbook = {
    // 旧 API（签名不变；remove / removeByItem 新增的 reason 是可选参数）
    add, list, remove, removeByItem, clear, countBySource,
    // 新 API
    markCorrect, markWrong, countByStatus,
    // 3.0：离开规则的唯一入口 + 已攻克留痕
    creditCorrectByGid, creditWrongByGid, markCleared, clearedHistory,
    // 内部工具（供 migration / 测试使用）
    _upgradeEntry: upgradeEntry, _findEntry: findEntry, _extractGid: extractGid
  };
})(window);
