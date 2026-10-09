/**
 * MemoDeck 3.0 · 判分口径（纯逻辑，无 DOM / Vue 依赖）
 * 挂载到 window.ExamJudge
 *
 * DESIGN.md §4.3：**判分逻辑是全局唯一口径，不得产生第二套实现。**
 * 2.x 把它写在 app.js 的 Vue setup 闭包里，于是它只能被「界面点一遍」验到，
 * 单测碰不到——而它恰恰是整个产品最该被钉死的一段。
 * 3.0 把它挪到这里，app.js 只留一行转发。
 *
 * 口径（§4.2 / §4.3，逐条对应 test/v3-compat.test.js）：
 *   判断：所选布尔与标准一致 → 对；未作答 → 错（不送分）
 *   单选：所选字母与标准全等 → 对；未作答 → 错
 *   多选：所选字母集合排序后全等 → 对；未作答 → 错；漏选/多选/错选均算整题错，无部分给分
 *   异常：答案形状不合约定时按空集处理，该题永远判错，但不崩溃
 *   填空 / 问答 / 专项：无判分逻辑，一律用户自评
 *
 * 「未作答必须先判错」是这段代码里最容易写错的一处：判断题标准答案为 false 时，
 * `(null === 'true') === false` 会成立，白送一分。所以下面每个分支都先挡空。
 */
(function (global) {
  'use strict';

  const OBJECTIVE_TYPES = { true_false: true, single_choice: true, multi_choice: true };

  /** 系统判分的题型（其余一律用户自评或不判分） */
  function isObjective(rawType) {
    return OBJECTIVE_TYPES[rawType] === true;
  }

  /** 标准答案字母集合；形状不合约定（多选给了字符串/数字）时按空集处理 */
  function stdLetters(item) {
    if (!item) return [];
    const a = item.answer;
    if (Array.isArray(a)) return a.map(String).slice().sort();
    return [];
  }

  /**
   * 判断题的标准答案键（'true' / 'false'），供界面标「正确答案是哪一项」。
   * 必须与 judge 的 `!!item.answer` 同源 —— 界面把哪一项涂成绿色、就必须是判分
   * 认作正确的那一项，否则会出现「横幅说答对、按钮却是红的」。
   * @returns {string[]} 答案缺失时按 false 处理（与 judge 一致：`!!undefined` = false）
   */
  function stdTfKeys(item) {
    if (!item) return [];
    return [item.answer ? 'true' : 'false'];
  }

  /**
   * @param {object} item      题目条目（rawType / answer / options）
   * @param {string|null} choice    单选字母 或 判断的 'true' / 'false'
   * @param {string[]} [multiSel]   多选已选字母
   * @returns {boolean} 未作答、题型不由系统判分、答案形状异常 → 一律 false
   */
  function judge(item, choice, multiSel) {
    if (!item || !isObjective(item.rawType)) return false;

    if (item.rawType === 'true_false') {
      if (choice !== 'true' && choice !== 'false') return false;   // 未作答 → 错，不送分
      return (choice === 'true') === !!item.answer;
    }

    if (item.rawType === 'single_choice') {
      if (!choice) return false;
      // 与 2.x 逐字一致：字母全等才算对。DESIGN.md §9 第三步明确要求
      // 「迁移时保持原有取题管线与判分实现不变」，所以这里**不做**大小写或
      // 「A. 文本」的容错归一 —— 那会悄悄改变既有题库的判分结果。
      return choice === item.answer;
    }

    // multi_choice
    const sel = Array.isArray(multiSel) ? multiSel.filter(k => k != null && k !== '').map(String).slice().sort() : [];
    if (!sel.length) return false;                                  // 未作答 → 错
    const std = stdLetters(item);
    if (!std.length) return false;                                  // 答案形状异常 → 永远判错，不崩
    return sel.join(',') === std.join(',');                         // 漏选/多选/错选都为 false
  }

  global.ExamJudge = { isObjective, judge, stdLetters, stdTfKeys, OBJECTIVE_TYPES };
})(typeof window !== 'undefined' ? window : globalThis);
