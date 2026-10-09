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

  /* ============================================================
   * 长列表窗口化（§3.3「千题级」的性能实现）
   *
   * 要解决的不是「滚动卡」—— 实测 2000 行滚动本来就 56fps 满帧 ——
   * 而是**不为看不见的行建节点**：2000 题的浏览列表在「今日页」就已全部挂载
   * （24,740 个 DOM 节点里 24,004 个是它），开屏多花 1.4s、切到浏览页要 3.6s（4× 降速实测）。
   *
   * 两个"看起来对但会翻车"的做法，这里都避开了（各有实测证据）：
   * 1. **不用上下两个占位条撑高度**。改占位条高度会让整篇 30 万像素的文档重新布局，
   *    实测把滚动帧 p95 从 17.7ms 打到 33ms（手机）/61ms（桌面）。改成外框高度恒定 +
   *    内块 `transform: translate3d` 位移 —— transform 只走合成，不触发布局。
   * 2. **滚动回调里只在窗口边界真的变了才写数据**。每帧都写会让 Vue 每帧重渲染
   *    十几行，同样把 p95 打到 80ms；DOM 变更数从 90 降到个位数。
   *
   * 滚动容器仍然是**页面**：列表自己不滚。iOS 惯性、地址栏收放、底部导航让位
   * 那套 token 全部不受影响 —— 代价是窗口要自己换算「列表坐标 = 页面 scrollY − 列表文档位置」。
   * 算术在 js/virtual.js（纯函数、14 项单测），这里只管接线与 DOM 记账。
   * ============================================================ */
  const WindowList = {
    name: 'window-list',
    props: {
      items: { type: Array, required: true },
      rowHeight: { type: Number, default: 120 },   // 估算行高，渲染后按实测回填
      buffer: { type: Number, default: 6 },        // 视口上下各多渲染几行
      step: { type: Number, default: 6 },          // 窗口至少移动这么多行才重算（见 _recompute）
      keyOf: { type: Function, default: null },
      threshold: { type: Number, default: 60 }     // 少于这么多条就整份渲染
    },
    data() {
      return { start: 0, end: 0, padTop: 0, viewportH: 800, heights: [], version: 0 };
    },
    computed: {
      n() { return this.items.length; },
      wind() { return this.n > this.threshold; },
      offsets() { this.version; return global.ExamVirtual.buildOffsets(this.n, this.heights, this.rowHeight); },
      total() { this.version; return this.offsets[this.n]; },
      visible() {
        const out = [];
        for (let i = this.start; i < this.end; i++) out.push({ i: i, item: this.items[i] });
        return out;
      }
    },
    mounted() {
      window.addEventListener('scroll', this._onScroll, { passive: true });
      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onResize);
      this._onResize();
      this._recompute();
      this.$nextTick(this._measure);
    },
    beforeUnmount() {
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
    },
    updated() {
      this._observeRows();
      if (!this._ro) this._measure();     // 没有 ResizeObserver 的旧环境才回落到「每次更新都量」
    },
    watch: {
      // 换题库 / 过滤条件变了 → 高度记账作废（旧的实测高度属于旧的行）
      items() {
        this.heights = []; this.version++; this.start = 0; this.end = 0;
        this.$nextTick(() => { this._recompute(); this._measure(); });
      }
    },
    methods: {
      /* 滚动回调：**只在窗口边界真的变了才写数据**。
         这是这套东西能不能用的一票否决项 —— 每帧都 tick++ 会让 Vue 每帧重渲染
         十几行、再叠加一次强制布局，实测把滚动帧 p95 从 17.7ms 打到 80ms。 */
      _onScroll() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => { this._raf = 0; this._recompute(); });
      },
      _onResize() {
        this.viewportH = window.innerHeight || 800;
        this._recompute();
      },
      /** 按当前滚动位置重算窗口；边界没变就不动数据（→ 不触发渲染） */
      _recompute() {
        const el = this.$el;
        if (!el) return;
        if (!this.wind) {
          if (this.start === 0 && this.end === this.n) return;
          this.start = 0; this.end = this.n; this.padTop = 0;
          return;
        }
        const scrollY = window.scrollY || window.pageYOffset || 0;
        const top = el.getBoundingClientRect().top + scrollY;   // 列表在文档里的位置
        const r = global.ExamVirtual.windowRange(this.offsets, scrollY - top, this.viewportH, this.buffer);
        /* 缓冲只有当窗口**真的需要移动**时才换：当前窗口仍覆盖需求、且移动量小于 step 行时
           什么都不做。慢速滚动于是完全不产生 DOM 工作（实测把滚动帧从 44ms 压回接近全挂载的
           28ms 一档），快速滑动才付一次重渲染。buffer 越大步越省，代价是常驻行数变多。 */
        const covers = r.start >= this.start && r.end <= this.end && this.end > this.start;
        const drift = Math.abs(r.start - this.start);
        if (covers && drift < this.step) return;
        this.start = r.start; this.end = r.end; this.padTop = r.padTop;
      },
      /* 实测回填：量到的真实高度写回偏移表，用于「展开答案」把后面的行整体下推。
         挂了 ResizeObserver 时只在行**真的变高变矮**那一刻量，不逐帧读布局。 */
      _observeRows() {
        if (typeof ResizeObserver === 'undefined') return;
        if (!this._ro) {
          this._ro = new ResizeObserver(entries => {
            let next = this.heights, changed = false;
            for (const en of entries) {
              const i = Number(en.target.getAttribute('data-wl-i'));
              const h = en.borderBoxSize && en.borderBoxSize[0]
                ? en.borderBoxSize[0].blockSize
                : en.target.getBoundingClientRect().height;
              if (!(h > 0)) continue;
              const hh = Math.round(h * 100) / 100;
              if (Math.abs((next[i] === undefined ? -1 : next[i]) - hh) > 0.5) {
                next = global.ExamVirtual.applyMeasured(next, i, hh); changed = true;
              }
            }
            if (changed) { this.heights = next; this.version++; this.$nextTick(this._recompute); }
          });
        }
        const rows = this.$el.querySelectorAll('[data-wl-i]');
        for (let k = 0; k < rows.length; k++) this._ro.observe(rows[k]);
      },
      _measure() {
        const host = this.$el;
        if (!host || !host.querySelectorAll) return;
        const rows = host.querySelectorAll('[data-wl-i]');
        if (!rows.length) return;
        let next = this.heights, changed = false;
        for (let k = 0; k < rows.length; k++) {
          const i = Number(rows[k].getAttribute('data-wl-i'));
          const h = rows[k].getBoundingClientRect().height;
          if (!(h > 0)) continue;                    // 隐藏中（v-show）量到 0：跳过，别把 0 记进去
          const hh = Math.round(h * 100) / 100;
          const cur = next[i];
          if (cur === undefined || Math.abs(cur - hh) > 0.5) { next = global.ExamVirtual.applyMeasured(next, i, hh); changed = true; }
        }
        if (changed) { this.heights = next; this.version++; this.$nextTick(this._recompute); }
      }
    },
    template: `
      <div class="wl" role="list" :style="wind ? { height: total + 'px' } : null">
        <div class="wl-rows" :style="wind ? { transform: 'translate3d(0,' + padTop + 'px,0)' } : null">
          <div class="wl-row" v-for="v in visible" :key="keyOf ? keyOf(v.item, v.i) : v.i" :data-wl-i="v.i"
               role="listitem" :aria-setsize="n" :aria-posinset="v.i + 1">
            <slot name="row" :item="v.item" :index="v.i"></slot>
          </div>
        </div>
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
      'question-history': QuestionHistory,
      'window-list': WindowList
    },
    install(app) { Object.keys(this.components).forEach(k => app.component(k, this.components[k])); }
  };
})(window);
