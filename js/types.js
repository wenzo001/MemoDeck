/**
 * MemoDeck 3.0 · 题型注册表与作答控件（DESIGN.md §4.2 / §4.3）
 * 挂载到 window.ExamTypes
 *
 * 架构约定（破坏任何一条就会重新长出「一个题型两套样子」）：
 *  1. **每种题型必须在此注册**；未注册的 rawType 一律走 DefaultRenderer，
 *     显示题干 + 答案原始字段，不解析结构、不提供作答控件、不写进度、不判错。
 *  2. **专项题不另写实现**：special_fill_blank 复用 BlankInput，只有序号色改蓝。
 *  3. **形状即语义**：单选用圆形点、多选用方形框、填空用带序号输入框、判断用两个大按钮。
 *     不得为了视觉统一互换形状。
 *  4. **判分结果只有一个组件**（judge-result，见 js/components.js），
 *     判断/单选/多选共用，差异只在判分函数（js/app.js 的 judgeObjective）。
 *
 * 本文件只负责「呈现与采集」，不做判分、不写存储 —— 判分口径仍归 ExamApp 的
 * judgeObjective，与 2.x 完全一致（DESIGN.md §9 第三步：迁移时判分实现不变）。
 */
(function (global) {
  'use strict';

  // 选项键固定大写 A–Z
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /**
   * 题型注册表：rawType → { label, judge: 'auto'|'self'|'none', control: 组件名, shape }
   * 'auto' = 系统判分；'self' = 用户自评；'none' = 不判分（浏览/兜底）
   */
  const TYPE_PRESENTERS = {
    true_false:         { label: '判断题', judge: 'auto', control: 'tf-input',     shape: 'button' },
    single_choice:      { label: '单选题', judge: 'auto', control: 'choice-input', shape: 'radio'  },
    multi_choice:       { label: '多选题', judge: 'auto', control: 'choice-input', shape: 'check'  },
    fill_blank:         { label: '填空题', judge: 'self', control: 'blank-input',  shape: 'blanks' },
    special_fill_blank: { label: '专项题', judge: 'self', control: 'blank-input',  shape: 'blanks' },
    essay:              { label: '问答题', judge: 'self', control: 'essay-input',  shape: 'textarea' }
  };

  function presenterOf(rawType) {
    return TYPE_PRESENTERS[rawType] || null;
  }
  /** 未注册标识 → 走 DefaultRenderer（只读兜底），界面显示原始 type 字符串 */
  function isRegistered(rawType) { return !!TYPE_PRESENTERS[rawType]; }
  function isAutoJudged(rawType) {
    const p = TYPE_PRESENTERS[rawType];
    return !!p && p.judge === 'auto';
  }

  /**
   * 填空题的逐空答案：题库里的 `|` **仅在导入时**拆分，界面层完全不出现分隔符。
   * 这里是纯函数，供 core.js 的 normalizeQuestion 与单测共用。
   * @param {string} answer 形如 "鸦片|1840" 或 "鸦片｜1840"
   * @returns {string[]}
   */
  function splitBlankAnswers(answer) {
    if (answer == null) return [];
    return String(answer)
      .split(/[|｜]/)            // 半角 | 与全角 ｜ 都接受
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * 从题干里数空位：`____`（≥2 个下划线）算一个空。
   * 题库 blanks 数组缺失时用它决定要渲染几个输入框。
   */
  function countBlankSlots(question) {
    const m = String(question || '').match(/_{2,}/g);
    return m ? m.length : 0;
  }

  /**
   * 把题干渲染成 HTML：`____` → 下划线占位块，其余原样。
   * ⚠️ 题干一律先转义再拼标记 —— 题库内容不可信，直接 v-html 等于开 XSS。
   */
  function questionHtml(question, filledCount) {
    const esc = String(question == null ? '' : question)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let i = 0;
    return esc.replace(/_{2,}/g, function () {
      const filled = i < (filledCount || 0);
      i++;
      return '<span class="md-blank-slot' + (filled ? ' is-filled' : '') + '"></span>';
    });
  }

  function optionEntries(item) {
    const o = item && item.options;
    if (!o || typeof o !== 'object') return [];
    return Object.keys(o).map(k => ({ key: k, text: o[k] }));
  }

  /* ============================================================
   * 组件
   * ============================================================ */

  // 题干：把 ____ 变成下划线占位块（§4.2）
  const QuestionText = {
    name: 'question-text',
    props: { item: { type: Object, required: true }, filled: { type: Number, default: 0 } },
    computed: {
      html() { return questionHtml(this.item.question, this.filled); }
    },
    template: `<span class="md-question-text" v-html="html"></span>`
  };

  // 判断题：两个大按钮，不用开关（开关暗示状态，作答是动作）
  const TfInput = {
    name: 'tf-input',
    props: {
      item: { type: Object, required: true },
      modelValue: {},                       // 'true' | 'false' | null
      disabled: { type: Boolean, default: false },
      stateOf: { type: Function, default: null }   // (val) => '' | 'selected' | 'correct' | 'wrong'
    },
    emits: ['update:modelValue'],
    methods: {
      pick(v) { if (!this.disabled) this.$emit('update:modelValue', v); },
      on(v) { return this.modelValue === v; },
      cls(v) { return this.stateOf ? this.stateOf(v) : (this.on(v) ? 'selected' : ''); }
    },
    template: `
      <div class="md-tf" role="group" aria-label="判断">
        <button type="button" class="md-tf-btn" :class="cls('true')" :disabled="disabled" @click="pick('true')">
          <svg class="icon" aria-hidden="true"><use href="#i-check-circle"/></svg>正确
        </button>
        <button type="button" class="md-tf-btn" :class="cls('false')" :disabled="disabled" @click="pick('false')">
          <svg class="icon" aria-hidden="true"><use href="#i-x-circle"/></svg>错误
        </button>
      </div>`
  };

  // 单选=圆形点 / 多选=方形框：同一份实现，shape 决定形状与交互（§4.2 形状即语义）
  const ChoiceInput = {
    name: 'choice-input',
    props: {
      item: { type: Object, required: true },
      modelValue: {},                       // 单选：string；多选：string[]
      disabled: { type: Boolean, default: false },
      stateOf: { type: Function, default: null },
      flags: { type: Function, default: null }   // (val) => 判定文字（正确/漏选/你选）
    },
    emits: ['update:modelValue'],
    computed: {
      isMulti() { return this.item.rawType === 'multi_choice'; },
      entries() { return optionEntries(this.item); }
    },
    methods: {
      on(k) { return this.isMulti ? (Array.isArray(this.modelValue) && this.modelValue.indexOf(k) >= 0) : this.modelValue === k; },
      cls(k) { return this.stateOf ? this.stateOf(k) : (this.on(k) ? 'selected' : ''); },
      flag(k) { return this.flags ? this.flags(k) : ''; },
      toggle(k) {
        if (this.disabled) return;
        if (!this.isMulti) { this.$emit('update:modelValue', k); return; }
        const cur = Array.isArray(this.modelValue) ? this.modelValue.slice() : [];
        const i = cur.indexOf(k);
        if (i >= 0) cur.splice(i, 1); else cur.push(k);
        cur.sort();
        this.$emit('update:modelValue', cur);
      }
    },
    template: `
      <div class="md-opt-list" :role="isMulti ? 'group' : 'radiogroup'" :aria-label="item.typeLabel">
        <button v-for="(o, i) in entries" :key="o.key" type="button" class="md-opt"
                :class="[isMulti ? 'is-check' : 'is-radio', cls(o.key)]"
                :disabled="disabled" :aria-pressed="on(o.key) ? 'true' : 'false'"
                @click="toggle(o.key)">
          <span class="md-opt-key" aria-hidden="true">
            <svg v-if="on(o.key) || cls(o.key) === 'correct' || cls(o.key) === 'wrong' || cls(o.key) === 'missed'"
                 class="icon" aria-hidden="true"><use :href="cls(o.key) === 'wrong' ? '#i-x' : '#i-check'"/></svg>
            <template v-else>{{ o.key }}</template>
          </span>
          <span class="md-opt-body">{{ o.text }}</span>
          <span class="md-opt-flag" v-if="flag(o.key)">{{ flag(o.key) }}</span>
          <span class="md-opt-kbd" aria-hidden="true">{{ o.key }}</span>
        </button>
      </div>`
  };

  // 填空题：逐空输入（§4.2 决策）。专项题复用本组件，序号色改蓝。
  const BlankInput = {
    name: 'blank-input',
    props: {
      item: { type: Object, required: true },
      modelValue: { type: Array, default: () => [] },   // ['', '', '']
      disabled: { type: Boolean, default: false }
    },
    emits: ['update:modelValue'],
    computed: {
      isSpecial() { return this.item.rawType === 'special_fill_blank'; },
      slotCount() {
        const b = this.item.blanks;
        if (Array.isArray(b) && b.length) return b.length;
        const n = countBlankSlots(this.item.question);
        return n > 0 ? n : 1;
      },
      filledCount() { return (this.modelValue || []).filter(s => String(s || '').trim()).length; }
    },
    watch: {
      slotCount: {
        immediate: true,
        handler(n) {
          const cur = Array.isArray(this.modelValue) ? this.modelValue.slice() : [];
          if (cur.length === n) return;
          while (cur.length < n) cur.push('');
          cur.length = n;
          this.$emit('update:modelValue', cur);
        }
      }
    },
    methods: {
      set(i, v) {
        const next = (this.modelValue || []).slice();
        next[i] = v;
        this.$emit('update:modelValue', next);
      },
      // 键盘「上一空/下一空」（§4.2：移动端改为点击序号或输入框）
      focusPrev(i) { const el = this.$refs['in' + (i - 1)]; (Array.isArray(el) ? el[0] : el) && (Array.isArray(el) ? el[0] : el).focus(); },
      focusNext(i) { const el = this.$refs['in' + (i + 1)]; (Array.isArray(el) ? el[0] : el) && (Array.isArray(el) ? el[0] : el).focus(); }
    },
    template: `
      <div class="md-blank" :class="{ 'is-special': isSpecial }">
        <div class="md-blank-list">
          <div class="md-blank-row" v-for="n in slotCount" :key="n">
            <span class="md-blank-index">{{ n }}</span>
            <input :ref="'in' + (n - 1)" type="text" class="md-field"
                   :value="(modelValue && modelValue[n - 1]) || ''"
                   :disabled="disabled" inputmode="text" autocomplete="off"
                   placeholder="请输入…"
                   :aria-label="'第 ' + n + ' 空'"
                   @input="set(n - 1, $event.target.value)"
                   @keyup.left="focusPrev(n - 1)" @keyup.right="focusNext(n - 1)">
          </div>
        </div>
        <div class="md-blank-meta">共 {{ slotCount }} 空 · 已填 {{ filledCount }} 空</div>
      </div>`
  };

  // 问答题：多行文本域 ≥16px + 字数（§4.2）
  const EssayInput = {
    name: 'essay-input',
    props: {
      item: { type: Object, required: true },
      modelValue: { type: String, default: '' },
      disabled: { type: Boolean, default: false }
    },
    emits: ['update:modelValue'],
    computed: { len() { return String(this.modelValue || '').length; } },
    template: `
      <div class="md-essay">
        <textarea class="md-field tall" :value="modelValue" :disabled="disabled" rows="5"
                  placeholder="请写出你的答案…"
                  @input="$emit('update:modelValue', $event.target.value)"></textarea>
        <div class="md-field-count">{{ len }} 字</div>
      </div>`
  };

  // 未知题型兜底：不解析结构、不提供作答、不写进度（§4.2「绝不崩溃」）
  const DefaultRenderer = {
    name: 'default-renderer',
    props: { item: { type: Object, required: true } },
    computed: {
      rawAnswer() {
        const it = this.item;
        let o;
        try {
          o = { answer: it.answer, options: it.options, type: it.rawType };
        } catch (e) { o = { type: it.rawType }; }
        return JSON.stringify(o, null, 2);
      }
    },
    template: `
      <div>
        <caliber-note icon="i-warn">本应用不支持此题型，仅显示原始内容；不判分、不写进度。</caliber-note>
        <div class="md-unknown-box">
          原始答案字段（原样展示，不解析）
          <pre>{{ rawAnswer }}</pre>
        </div>
      </div>`
  };

  /**
   * 题型分发器：按注册表挑控件。未注册 → DefaultRenderer。
   * 用 v-model 参数把四种作答模型一次接完，页面层不需要再按题型写 v-if。
   */
  const QRenderer = {
    name: 'q-renderer',
    props: {
      item: { type: Object, required: true },
      disabled: { type: Boolean, default: false },
      choice: { default: null },
      multi: { type: Array, default: () => [] },
      blanks: { type: Array, default: () => [] },
      essay: { type: String, default: '' },
      stateOf: { type: Function, default: null },
      flags: { type: Function, default: null }
    },
    emits: ['update:choice', 'update:multi', 'update:blanks', 'update:essay'],
    computed: {
      presenter() { return TYPE_PRESENTERS[this.item.rawType] || null; },
      control() { return this.presenter ? this.presenter.control : 'default-renderer'; }
    },
    template: `
      <component :is="control" :item="item" :disabled="disabled" :state-of="stateOf" :flags="flags"
                 :model-value="control === 'choice-input' ? (item.rawType === 'multi_choice' ? multi : choice)
                               : (control === 'blank-input' ? blanks
                               : (control === 'essay-input' ? essay : null))"
                 @update:model-value="onVal"></component>`,
    methods: {
      onVal(v) {
        if (this.control === 'blank-input') this.$emit('update:blanks', v);
        else if (this.control === 'essay-input') this.$emit('update:essay', v);
        else if (this.item.rawType === 'multi_choice') this.$emit('update:multi', v);
        else this.$emit('update:choice', v);
      }
    }
  };

  global.ExamTypes = {
    TYPE_PRESENTERS, presenterOf, isRegistered, isAutoJudged,
    splitBlankAnswers, countBlankSlots, questionHtml, optionEntries, LETTERS,
    components: {
      'question-text': QuestionText,
      'tf-input': TfInput,
      'choice-input': ChoiceInput,
      'blank-input': BlankInput,
      'essay-input': EssayInput,
      'default-renderer': DefaultRenderer,
      'q-renderer': QRenderer
    },
    /** 在 Vue app 上注册全部题型控件 */
    install(app) { Object.keys(this.components).forEach(k => app.component(k, this.components[k])); }
  };
})(window);
