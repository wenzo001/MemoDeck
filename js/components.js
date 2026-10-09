/**
 * MemoDeck 3.0 · 共享 UI 组件（DESIGN.md §4.1 组件族 / §4.3 判分结果 / §4.4 作答状态）
 * 挂载到 window.ExamComponents
 *
 * 这里放的是**跨页面复用且只准有一份实现**的东西：
 *  - judge-result：判断/单选/多选共用的判分结果横幅（§4.3「禁止为任一题型另写一套结果展示」）
 *  - answer-view：参考答案呈现（§4.2「凡带选项的题，选项文本与答案必须同屏可见」）
 *  - status-chip：两套四档状态芯片（§7.3 命名消歧的唯一出口）
 *  - triplet / caliber-note / resume-card / question-history
 *
 * 状态一律「形状 + 文字 + 颜色」三线索（§2.4），颜色只是冗余线索。
 */
(function (global) {
  'use strict';

  /* ============================================================
   * 口径说明条（§4.1：常显，不可省；§7.2 六条口径全部要有明确表达）
   * ============================================================ */
  const CaliberNote = {
    name: 'caliber-note',
    props: { icon: { type: String, default: 'i-info' } },
    template: `
      <p class="md-caliber">
        <svg class="icon" aria-hidden="true"><use :href="'#' + icon"/></svg>
        <span><slot /></span>
      </p>`
  };

  /* ============================================================
   * 状态芯片（§4.1 组件族，8 档）
   *
   * §7.3 命名消歧是本重设计的核心之一，两套四档在这里唯一收敛：
   *   memory 侧（跨会话记忆进度）：新题 / 学习中 / 需复习 / 已掌握
   *   wrong   侧（错题本）        ：新错 / 巩固中 / 模糊 / 已攻克
   * 数据层两个概念都叫 weak，界面绝不能同名 —— 用 set 参数决定读哪张词表。
   * ============================================================ */
  const CHIP_WORD = {
    memory: {
      new:      { label: '新题',   cls: 'is-new' },
      learning: { label: '学习中', cls: 'is-learning' },
      review:   { label: '需复习', cls: 'is-review' },
      weak:     { label: '需复习', cls: 'is-review' },   // 数据层 weak = learning+review 聚合
      mastered: { label: '已掌握', cls: 'is-mastered' }
    },
    wrong: {
      new:      { label: '新错',   cls: 'is-wrong' },
      learning: { label: '巩固中', cls: 'is-solidify' },
      weak:     { label: '模糊',   cls: 'is-vague' },
      mastered: { label: '已攻克', cls: 'is-cleared' }
    },
    session: { round: { label: '本轮攻克', cls: 'is-round' } }
  };

  const StatusChip = {
    name: 'status-chip',
    props: {
      kind: { type: String, required: true },
      set:  { type: String, default: 'memory' },   // memory | wrong | session
      icon: { type: String, default: '' }
    },
    computed: {
      word() {
        const table = CHIP_WORD[this.set] || CHIP_WORD.memory;
        return table[this.kind] || { label: this.kind, cls: 'is-new' };
      },
      cls() { return this.word.cls; },
      label() { return this.word.label; },
      iconId() {
        if (this.icon) return this.icon;
        const c = this.word.cls;
        if (c === 'is-mastered' || c === 'is-cleared') return 'i-trophy';
        if (c === 'is-wrong') return 'i-x-circle';
        if (c === 'is-learning' || c === 'is-solidify') return 'i-flame';
        if (c === 'is-review' || c === 'is-vague') return 'i-clock';
        return 'i-circle';
      }
    },
    template: `<span class="md-chip" :class="cls"><svg class="icon" aria-hidden="true"><use :href="'#' + iconId"/></svg>{{ label }}</span>`
  };

  /* ============================================================
   * 统计三联格（§4.1：圆角 10、数字 19–20 + 标签 11、数字变化 200ms 滚动）
   * cells: [{ n, label, tone }]，tone = '' | ok | no | pend
   * ============================================================ */
  const Triplet = {
    name: 'triplet',
    props: { cells: { type: Array, default: () => [] } },
    data() { return { rolling: {} }; },
    watch: {
      cells: {
        deep: true,
        handler(next, prev) {
          // 只对「值真的变了」的那一格放一次脉冲；常驻动画在 Dashboard 场景是噪声
          next.forEach((c, i) => {
            const before = prev && prev[i];
            if (before && before.n !== c.n) {
              this.rolling[i] = false;
              this.$nextTick(() => { this.rolling[i] = true; });
              setTimeout(() => { this.rolling[i] = false; }, 220);
            }
          });
        }
      }
    },
    template: `
      <div class="md-triplet">
        <div class="md-triplet-cell" v-for="(c, i) in cells" :key="c.label">
          <div class="md-triplet-num" :class="[c.tone || '', rolling[i] ? 'is-rolling' : '']">{{ c.n }}</div>
          <div class="md-triplet-lbl">{{ c.label }}</div>
        </div>
      </div>`
  };

  /* ============================================================
   * 判分结果横幅（§4.3：判断/单选/多选共用同一组件，仅判分逻辑不同）
   *
   * result.correct: true 答对 / false 答错 / null|undefined 待自评
   * result.reason  ：附在结论后面的口径（例如「已加入错题本」）
   * §4.4 的 7 种作答状态里，这一块负责「已判对 / 已判错 / 待自评」三档。
   * ============================================================ */
  const JudgeResult = {
    name: 'judge-result',
    props: { result: { type: Object, required: true } },
    computed: {
      state() {
        if (this.result.correct === true) return 'right';
        if (this.result.correct === false) return 'wrong';
        return 'pending';
      },
      iconId() {
        return this.state === 'right' ? 'i-check' : (this.state === 'wrong' ? 'i-x' : 'i-dot');
      },
      title() {
        if (this.state === 'right') return this.result.title || '回答正确';
        if (this.state === 'wrong') return this.result.title || '回答错误';
        return this.result.title || '待你评定';
      },
      note() {
        if (this.state === 'right') return this.result.note || '';
        if (this.state === 'wrong') return this.result.note || '已加入错题本 · 停在本题，看懂后再前进';
        return this.result.note || '未计入正确率';
      },
      caliber() {
        if (this.state === 'pending') return '此刻不算错、不计分、不写进度；成绩页逐题评定后才计入。';
        if (this.state === 'wrong') return '答错：连对归零、退回学习中、下次复习时间＝立即；已掌握的降级为需复习。';
        return '答对：次数 +1、连对 +1、按 streak 重排下次复习时间；不进错题本。';
      }
    },
    template: `
      <div class="md-judge-banner" :class="'is-' + state" role="status" aria-live="polite">
        <span class="md-judge-badge" aria-hidden="true"><svg class="icon"><use :href="'#' + iconId"/></svg></span>
        <div>
          <div class="md-judge-title">{{ title }}<template v-if="note"> · {{ note }}</template></div>
          <span class="md-judge-caliber">{{ caliber }}</span>
        </div>
      </div>`
  };

  /* ============================================================
   * 参考答案呈现（§4.2）
   *  - 填空题：逐空列出，序号显式
   *  - 判断题：「错误 / 正确」
   *  - 单选/多选：**键 + 文本**（不能只给字母，背诵要「题干+选项+答案」一起读）
   *  - 问答：参考文本 ≤300 字，不折叠
   *  - 未注册题型：原始字段原样展示
   * ============================================================ */
  const AnswerView = {
    name: 'answer-view',
    props: { item: { type: Object, required: true } },
    computed: {
      isFill() { return this.item.rawType === 'fill_blank' || this.item.rawType === 'special_fill_blank'; },
      isChoice() { return this.item.rawType === 'single_choice' || this.item.rawType === 'multi_choice'; },
      stdKeys() {
        const a = this.item.answer;
        if (this.item.rawType === 'multi_choice') return Array.isArray(a) ? a : String(a || '').split(/[,，\s]+/).filter(Boolean);
        return a ? [String(a)] : [];
      },
      optionEntries() {
        const o = this.item.options;
        if (!o || typeof o !== 'object') return [];
        return Object.keys(o).map(k => ({ key: k, text: o[k] }));
      },
      answerText() {
        const t = this.item.rawType, a = this.item.answer;
        if (t === 'true_false') return a ? '正确' : '错误';
        if (Array.isArray(a)) return a.join('、');
        if (a == null || a === '') return '（题库未提供答案）';
        return String(a);
      },
      registered() { return global.ExamTypes && global.ExamTypes.isRegistered(this.item.rawType); }
    },
    template: `
      <div class="answer-box" :class="{ 'is-special': item.rawType === 'special_fill_blank' }">
        <div class="answer-title">参考答案</div>

        <template v-if="isFill">
          <div class="answer-item" v-for="(b, i) in (item.blanks || [])" :key="i">
            <span class="answer-index">{{ b.index || (i + 1) }}</span>
            <span class="answer-text">{{ b.answer }}</span>
          </div>
          <div class="answer-item" v-if="!(item.blanks || []).length">
            <span class="answer-text">{{ answerText }}</span>
          </div>
        </template>

        <template v-else-if="item.rawType === 'true_false'">
          <span class="answer-text" :class="item.answer ? 'ans-ok' : 'ans-no'">{{ answerText }}</span>
        </template>

        <template v-else-if="isChoice">
          <div class="answer-options">
            <div class="answer-option" v-for="o in optionEntries" :key="o.key"
                 :class="{ 'is-std': stdKeys.indexOf(o.key) >= 0 }">
              <span class="k">{{ o.key }}.</span><span>{{ o.text }}</span>
            </div>
          </div>
          <div class="answer-item" style="margin-top:10px;">
            <span class="answer-index">答案</span><span class="answer-text">{{ answerText }}</span>
          </div>
        </template>

        <template v-else>
          <span class="answer-text">{{ answerText }}</span>
        </template>

        <div class="answer-explanation" v-if="item.explanation">解析：{{ item.explanation }}</div>
      </div>`
  };

  /* ============================================================
   * 恢复提示卡（§4.1 三段式：图标 / 文本 / 按钮；§7.5 时间戳）
   * resumes: [{ mode, label, position, when }]
   * ============================================================ */
  const ResumeCard = {
    name: 'resume-card',
    props: { resumes: { type: Array, default: () => [] } },
    emits: ['resume', 'dismiss'],
    template: `
      <div class="md-resume-card" v-for="r in resumes" :key="r.mode" role="status">
        <span class="md-resume-icon" aria-hidden="true"><svg class="icon"><use href="#i-save"/></svg></span>
        <div class="md-resume-body">
          <div class="md-resume-title">继续上次的{{ r.label }}</div>
          <div class="md-resume-when">{{ r.when }} · {{ r.position }}</div>
        </div>
        <div class="md-resume-actions">
          <button class="btn" @click="$emit('resume', r.mode)">继续</button>
          <button class="md-resume-close" @click="$emit('dismiss', r.mode)" aria-label="放弃这次恢复点">
            <svg class="icon" aria-hidden="true"><use href="#i-x"/></svg>
          </button>
        </div>
      </div>`
  };

  /* ============================================================
   * 「这道题的历史」（§5.4：平板/桌面独有，移动端放不下）
   * 学过次数、上次结果、当前连对、错题记录
   * ============================================================ */
  const QuestionHistory = {
    name: 'question-history',
    props: { entry: { default: null }, wrong: { default: null }, item: { type: Object, required: true } },
    computed: {
      p() { return this.entry || {}; },
      attempts() { return this.p.attempts || 0; },
      lastResult() {
        if (!this.p.lastReviewedAt) return '尚未作答';
        if (this.p.status === 'mastered') return '已掌握';
        return (this.p.wrong && this.p.streak === 0) ? '答错' : '答对';
      },
      streakText() { return (this.p.streak || 0) + ' 次'; },
      dueText() {
        if (!this.p.nextReviewAt) return '未排期';
        const d = new Date(this.p.nextReviewAt);
        if (isNaN(d.getTime())) return '未排期';
        return d.getMonth() + 1 + '/' + d.getDate() + ' 期满';
      },
      wrongText() {
        if (!this.wrong) return '不在错题本';
        return '出错 ' + (this.wrong.wrongCount || 1) + ' 次';
      }
    },
    template: `
      <div class="md-home-card md-history-card">
        <div class="md-home-card-head"><span class="md-home-card-title"><svg class="icon" aria-hidden="true"><use href="#i-history"/></svg>这道题的历史</span></div>
        <div class="history-cell"><span>学过次数</span><b>{{ attempts }} 次</b></div>
        <div class="history-cell"><span>上次结果</span><b>{{ lastResult }}</b></div>
        <div class="history-cell"><span>当前连对</span><b>{{ streakText }}</b></div>
        <div class="history-cell"><span>下次复习</span><b>{{ dueText }}</b></div>
        <div class="history-cell"><span>错题记录</span><b>{{ wrongText }}</b></div>
      </div>`
  };

  global.ExamComponents = {
    CHIP_WORD,
    components: {
      'caliber-note': CaliberNote,
      'status-chip': StatusChip,
      'triplet': Triplet,
      'judge-result': JudgeResult,
      'answer-view': AnswerView,
      'resume-card': ResumeCard,
      'question-history': QuestionHistory
    },
    install(app) { Object.keys(this.components).forEach(k => app.component(k, this.components[k])); }
  };
})(window);
