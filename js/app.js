/**
 * MemoDeck · Vue 应用逻辑
 * 依赖：vendor/vue.global.prod.js（全局 Vue）、ExamCore / ExamStore / ExamLeitner / ExamWrongbook / ExamAIPrompt
 * 挂载：index.html 中的 #app（in-DOM template）
 */
(function (global) {
  'use strict';

  const { createApp, ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } = global.Vue;
  const Core = global.ExamCore;
  const Store = global.ExamStore;
  const Leitner = global.ExamLeitner;
  const Wrongbook = global.ExamWrongbook;
  const AIPrompt = global.ExamAIPrompt;
  const Utils = global.ExamUtils;
  const Queue = global.ExamQueue;
  // —— 阶段 0 新增模块 ——
  const Migration = global.ExamMigration;
  const Progress = global.ExamProgress;
  const Session = global.ExamSession;
  const Stats = global.ExamStats;
  // 3.0 新增：题型注册表 + 共享组件（js/types.js、js/components.js）
  const Types = global.ExamTypes;
  const UIComponents = global.ExamComponents;

  /* ============ 3.0 导航模型（DESIGN.md §5.1：8 入口 → 4 一级导航） ============
     表与解析逻辑都在 js/navigation.js（纯函数、可在 Node 单测）。这里只留引用：
     映射表放两份必然漂移，而它一错就是「旧书签 + 旧恢复点 + 旧题库开关」同时失效。 */
  const Nav = global.ExamNav;
  const Judge = global.ExamJudge;
  const NAV_ITEMS = Nav.NAV_ITEMS;
  const NARROW_NAV = Nav.NARROW_NAV;
  const PRACTICE_MODES = Nav.PRACTICE_MODES;


  // 运行配置见 config.js（defaultRemoteUrl / jsonManagerUrl 均可外部覆盖）
  const CFG = global.EXAM_CONFIG || {};
  const DEFAULT_REMOTE_URL = CFG.defaultRemoteUrl || './data.json';
  const JSON_MANAGER_URL = CFG.jsonManagerUrl || ''; // 留空则隐藏「JSON 管理服务」入口

  const app = createApp({
    setup() {
      /* ============ 基础 / 数据源 ============ */
      const activeTab = ref('today');               // 3.0 一级导航：today | practice | wrongbook | bank
      const practiceMode = ref(localStorage.getItem('memo:practiceMode') || 'recite');
      const showMoreSheet = ref(false);             // 320–359 的「更多」抽屉
      const wbOpen = reactive({});                  // 错题条目「展开全文」
      // 通用确认对话框（交卷确认 / 清空全部数据 等不可逆操作走同一个组件）
      const dialog = ref(null);                     // { title, body, okText, danger, resolve }
      const isNarrow = ref(!!(window.matchMedia && window.matchMedia('(max-width: 359px)').matches));
      const isWide = ref(!!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches));
      // 折叠屏形态（§8）：560 是导航形态切换点，768 是双栏切换点
      const formFactor = ref('');
      const formHint = ref('');
      let formHintTimer = null;
      let lastFormBucket = '';
      const sourceMeta = ref({ label: '加载中…', cls: 'default', url: '', detail: '' });
      const currentBank = ref({ meta: {}, features: {}, papers: [] });
      const currentPaperId = ref('');
      const bank = ref([]);                          // 题目条目数组
      const dataError = ref('');
      const remoteUrl = ref('');
      const pasteText = ref('');
      const managerUrl = ref(JSON_MANAGER_URL);
      // 3.0：原「数据管理」浮层已并入「题库」一级页面；showDataPanel / memo:showDataPanel
      // 这两个键不再被读写。留着只会让人以为还有一个可展开的后台面板（死控件）。
      const confirmClearAll = ref(false); // 备份区二次确认
      const dataBusy = ref(false);
      const dragActive = ref(false);
      const toastMsg = ref('');
      const toastOk = ref(true);
      let toastTimer = null;

      /* ============ 主题 ============ */
      // 'auto' | 'light' | 'dark'（持久化键 memo:theme 与取值域从 2.x 沿用，不改）
      const themeMode = ref(localStorage.getItem('memo:theme') || 'auto');
      function systemPrefersDark() {
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
      // 3.0：data-theme 永远被写成解析后的 'light' | 'dark'，不再靠「移除属性 + 媒体查询」。
      // auto 模式由这里读系统偏好并落属性，于是 token 层的深色声明只需要
      // `html[data-theme="dark"]` 一处（见 css/tokens.css），2.x 的三份重复与
      // 「系统 dark + 手动 light 漏深色」这一类 bug 一并消失。
      function applyTheme() {
        var mode = themeMode.value;
        var resolved = mode === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
        document.documentElement.setAttribute('data-theme', resolved);
        localStorage.setItem('memo:theme', mode);
        return resolved;
      }
      // 初始化立即应用
      applyTheme();
      // 跟随系统偏好变化（auto 模式下实时重新解析）
      if (window.matchMedia) {
        var mql = window.matchMedia('(prefers-color-scheme: dark)');
        mql.addEventListener && mql.addEventListener('change', function () {
          if (themeMode.value === 'auto') applyTheme();
        });
      }

      /* ============ 阶段 0 新增：学习状态 & 统计 ============ */
      // 刷新信号：每次 bump 让 dashboard/dailyTask 重新计算
      const progressTick = ref(0);
      function refreshProgress() { progressTick.value++; }

      // 题库稳定标识：恢复点按它归属，切库后旧恢复点不再冒出来
      function bankIdOf() {
        const m = currentBank.value.meta;
        return m && m.title ? String(m.title) : '';
      }

      /* —— watchers：主题状态持久化 —— */
      Vue.watch(themeMode, function () { applyTheme(); });

      /* —— 会话计时器：study / exercise / exam 三处原本逐字重复 —— */
      function makeSessionTimer(elapsedSec, startAtRef) {
        let handle = null;
        return {
          start() {
            if (handle) clearInterval(handle);
            handle = setInterval(() => {
              elapsedSec.value = Math.floor((Date.now() - startAtRef.value) / 1000);
            }, 1000);
          },
          stop() {
            if (handle) { clearInterval(handle); handle = null; }
          }
        };
      }

      /* —— 滑动手势：study / exercise 两处原本各有一套平行的 start/move/end —— */
      // 首个超出死区的位移一次性定轴：判为纵向就把滚动交还浏览器，且本次触摸不再改判，
      // 否则斜着拖会在「滑卡」和「滚页」之间反复横跳。
      function makeSwipe(opts) {
        const AXIS_DEADZONE = 8;
        const x = ref(0);
        const active = ref(false);
        const axis = { locked: false, horizontal: false };
        let startX = 0, startY = 0;
        return {
          x, active,
          onStart(e) {
            if (!opts.enabled()) return;
            const pt = e.touches ? e.touches[0] : e;
            startX = pt.clientX; startY = pt.clientY;
            x.value = 0;
            axis.locked = false; axis.horizontal = false;
            active.value = true;
          },
          onMove(e) {
            if (!active.value) return;
            const pt = e.touches ? e.touches[0] : e;
            const dx = pt.clientX - startX;
            const dy = pt.clientY - startY;
            if (!axis.locked) {
              if (Math.abs(dx) < AXIS_DEADZONE && Math.abs(dy) < AXIS_DEADZONE) return;
              axis.locked = true;
              axis.horizontal = Math.abs(dx) > Math.abs(dy);
            }
            if (!axis.horizontal) return;
            x.value = dx;
            if (e.cancelable) e.preventDefault();
          },
          onEnd() {
            if (!active.value) return;
            active.value = false;
            const moved = x.value;
            x.value = 0;
            opts.onSwipe(moved);
          }
        };
      }

      /* ============ 共享取题管线 ============ */
      // 算法本体在 js/queue.js（纯逻辑、可在 Node 单测）；这里只把 Vue 的 ref 喂给它。
      function queueCtx(overrides) {
        const all = bankGids.value;
        return Object.assign({
          allGids: all,
          progressMap: Progress.getAll(),
          wrongGids: new Set(wrongEntries.value.map(e => e.item && e.item.gid).filter(Boolean)),
          dueGids: Progress.getDueQuestions(all),
          itemsByGid: new Map(bank.value.map(it => [it.gid, it])),
          dailyTask: Session.generateDailyTask
        }, overrides || {});
      }
      function buildQueueGids(cfg) {
        return Queue.buildQueueGids(Object.assign(queueCtx(), { cfg: cfg }), cfg);
      }
      function queueCountOf(cfg) {
        return Queue.queueCountOf(Object.assign(queueCtx(), { cfg: cfg }), cfg);
      }

      /* ============ 记忆闯关 ============ */
      const practiceQueue = ref([]);
      const practiceShowAnswer = ref(false);

      /* ============ 摸底速览 ============ */
      const previewRevealed = reactive({});

      /* ============ 分类考试 ============ */
      const catStage = ref('setup');                 // setup | test | done
      const catSelected = ref([]);                   // 选中的 rawType
      const catPool = ref([]);
      const catIndex = ref(0);
      const catInput = ref('');
      const catChoice = ref(null);
      const catMultiSel = ref([]);
      const catBlanks = ref([]);                   // 填空/专项逐空答案（§4.2）
      const catRevealed = ref(false);
      const catFeedback = ref(null);                 // { correct }
      // 3.0：填空题逐空答案改由 catBlanks 承载，旧的 catFillInput（插入分隔符用）已删除
      const catStats = reactive({ total: 0, right: 0, wrong: 0 });
      const catFromWrongbook = ref(false); // 当前考试是否来自错题本（答对自动移除错题）
      const catSnapshots = ref({});        // 每题作答快照：{ index: {input,choice,multiSel,revealed,feedback} }
      const catStartTime = ref(0);         // 考试开始时间戳
      const catElapsed = ref('');          // 考试用时文本
      let autoNextTimer = null;            // 答对自动进下一题的定时器
      const catWrongItems = ref([]);
      const catError = ref('');
      const customForm = reactive({ question: '', type: 'single_choice', options: '', answer: '' });

      /* ============ 错题本 ============ */
      // 错题来源注册表：新增模式只改这里，Tab / 计数 / 标签自动跟上。
      // 之前写死 practice/preview/exam 三个，study / exercise 产生的错题只能从「全部」里看到。
      const WRONG_SOURCES = [
        { key: 'study',    label: '学习' },
        { key: 'exercise', label: '练习' },
        { key: 'practice', label: '记忆闯关' },
        { key: 'preview',  label: '摸底速览' },
        { key: 'exam',     label: '考试' }
      ];
      const wrongEntries = ref([]);
      const wrongTab = ref('all');                   // all | WRONG_SOURCES[].key
      const wrongPracticeQueue = ref([]);
      const wrongPracticeShow = ref(false);

      /* ============ 阶段 2：学习/背诵模式 ============ */
      // 状态机：setup → running → summary
      const studyMode = ref('setup');

      // setup 配置
      const studyScope = ref('today');               // today | unmastered | all | wrongbook | custom
      const studyCustomStart = ref(1);
      const studyCustomEnd = ref(0);                 // 0 表示自动填充总题数
      const studyStrategy = ref('due');              // due | sequential | random
      const studyPerSession = ref(30);
      const studyPerSessionCustom = ref(20);         // 自定义数量
      const studyTypes = ref({ single_choice: true, multi_choice: true, true_false: true, fill_blank: true, special_fill_blank: true, essay: false });

      // running 状态
      const studyQueueGids = ref([]);
      const studyIndex = ref(0);
      const studyShowAnswer = ref(false);
      const studyStartAt = ref(0);
      const studyPassCount = ref(0);
      const studyFailCount = ref(0);
      const studyNewMastered = ref(0);
      const studyNewWrong = ref(0);
      const studyMaxStreak = ref(0);

      // 手势：右滑=记住了 / 左滑=还不会，必须先看过答案才允许滑动
      const studySwipe = makeSwipe({
        enabled: () => studyMode.value === 'running' && studyShowAnswer.value,
        onSwipe: x => {
          if (x >= STUDY_SWIPE_THRESHOLD) studyMark(true);
          else if (x <= -STUDY_SWIPE_THRESHOLD) studyMark(false);
        }
      });
      const studySwipeX = studySwipe.x;
      const studySwipeActive = studySwipe.active;
      const STUDY_SWIPE_THRESHOLD = 120;             // 触发阈值 px

      // summary 统计
      const studyElapsedSec = ref(0);
      const studyClock = makeSessionTimer(studyElapsedSec, studyStartAt);

      // computed：当前题目 item
      const studyCurrentItem = computed(() => {
        const gid = studyQueueGids.value[studyIndex.value];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const studyNextItem = computed(() => {
        const gid = studyQueueGids.value[studyIndex.value + 1];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const studyTotal = computed(() => studyQueueGids.value.length);
      const studyProgressPct = computed(() => {
        if (!studyTotal.value) return 0;
        return Math.round((studyIndex.value / studyTotal.value) * 100);
      });
      const studyCurrentProgress = computed(() => {
        if (!studyTotal.value) return '0/0';
        return (studyIndex.value + 1) + '/' + studyTotal.value;
      });
      // 当前题的学习历史（小字 hint）
      const studyPrevHint = computed(() => {
        const gid = studyCurrentItem.value && studyCurrentItem.value.gid;
        if (!gid) return '';
        const e = Progress.get(gid);
        if (!e) return '之前：未学过';
        const parts = [];
        if (e.attempts > 0) parts.push('学过 ' + e.attempts + ' 次');
        if (e.status === 'mastered') parts.push('已掌握');
        else if (e.status === 'review') parts.push('需复习');
        else if (e.wrong > 0) parts.push('上次答错');
        parts.push('streak ' + e.streak);
        return '之前：' + parts.join(' · ');
      });
      // setup 时实时计算各范围的题数：与 studyStart 走同一套管线，
      // 保证界面显示的「将学习 N 题」就是实际排队出来的题数
      function studyCfg() {
        return {
          scope: studyScope.value, start: studyCustomStart.value, end: studyCustomEnd.value,
          types: studyTypes.value, strategy: studyStrategy.value,
          perSession: studyPerSession.value, perSessionCustom: studyPerSessionCustom.value
        };
      }
      const studyScopeCounts = computed(() => {
        const ctx = queueCtx({ progressMap: progressMap.value });
        const cnt = sc => Queue.scopeGidsOf(sc, ctx).length;
        return {
          all: ctx.allGids.length,
          today: cnt('today'),
          unmastered: cnt('unmastered'),
          wrongbook: cnt('wrongbook')
        };
      });
      const studyCustomCount = computed(() =>
        queueCountOf(Object.assign(studyCfg(), { scope: 'custom' })));
      const studyAvailableCount = computed(() => queueCountOf(studyCfg()));

      // ====== setup → running ======
      function studyStart() {
        if (!studyAvailableCount.value) { toast('当前条件下没有可学习的题目', false); return; }
        const queueGids = buildQueueGids(studyCfg());
        if (!queueGids.length) { toast('队列生成为空，请换范围', false); return; }

        // 3. 启动
        studyQueueGids.value = queueGids;
        studyIndex.value = 0;
        studyShowAnswer.value = false;
        studyStartAt.value = Date.now();
        studyPassCount.value = 0;
        studyFailCount.value = 0;
        studyNewMastered.value = 0;
        studyNewWrong.value = 0;
        studyMaxStreak.value = 0;
        studyMode.value = 'running';

        // 保存恢复点
        Session.saveResumePoint({
          bankId: bankIdOf(),
          paperId: currentPaperId.value,
          mode: 'study',
          queueGids: queueGids,
          currentIndex: 0,
          segment: { scope: studyScope.value, start: studyCustomStart.value, end: studyCustomEnd.value }
        });

        // 计时器
        studyElapsedSec.value = 0;
        studyClock.start();
      }

      function studyResume() {
        const rp = Session.loadResumePoint(bankIdOf(), 'study');
        if (!rp) return;
        studyQueueGids.value = rp.queueGids || [];
        studyIndex.value = rp.currentIndex || 0;
        studyShowAnswer.value = false;
        // 恢复设置（尽量还原）
        const seg = rp.segment || {};
        if (seg.scope) studyScope.value = seg.scope;
        if (seg.start) studyCustomStart.value = seg.start;
        if (seg.end) studyCustomEnd.value = seg.end;
        // running 统计重置（恢复点只存位置不存统计）
        studyPassCount.value = 0;
        studyFailCount.value = 0;
        studyNewMastered.value = 0;
        studyNewWrong.value = 0;
        studyMaxStreak.value = 0;
        studyStartAt.value = Date.now();
        studyMode.value = 'running';
        studyElapsedSec.value = 0;
        studyClock.start();
      }

      // ====== running：mark + next ======
      function studyMark(remembered) {
        const item = studyCurrentItem.value;
        if (!item || !item.gid) return;
        const prev = Progress.get(item.gid);
        const prevStatus = prev ? prev.status : 'new';

        if (remembered) {
          const e = Progress.markPass(item.gid);
          studyPassCount.value++;
          if (e && e.streak > studyMaxStreak.value) studyMaxStreak.value = e.streak;
          if (prevStatus !== 'mastered' && e && e.status === 'mastered') studyNewMastered.value++;
          // 3.0 §7.4.1：背诵自评「记住了」同样计入错题本连对（2.x 这里不计次）
          _creditWrongbookCorrect(item.gid);
        } else {
          Progress.markFail(item.gid);
          studyFailCount.value++;
          Wrongbook.add(item, 'study', null, false);
          studyNewWrong.value++;
          loadWrongbook();
        }
        refreshProgress();

        // 自动下一题
        studyNext();
      }

      function studyNext() {
        studyShowAnswer.value = false;
        if (studyIndex.value + 1 >= studyQueueGids.value.length) {
          studyFinish();
        } else {
          studyIndex.value++;
          studySwipeX.value = 0;
          // 位置必须写回恢复点，否则「继续上次」永远从第 1 题重来
          Session.touchResumePoint(studyIndex.value, 'study');
        }
      }

      function studyFinish() {
        studyMode.value = 'summary';
        studyClock.stop();
        Session.clearResumePoint('study');
        refreshProgress();
      }

      function studyExit() {
        // 主动退出 running → 暂停，恢复点已在 saveResumePoint/touchResumePoint 里
        if (studyMode.value === 'running') {
          toast('已暂停，下次打开可继续', true);
          studyClock.stop();
          studyMode.value = 'setup';
          refreshResume();
          switchTab('today');
          setTimeout(() => { switchTab('practice'); setPracticeMode('recite'); }, 50);
        } else {
          studyMode.value = 'setup';
        }
      }

      function studyRestart() {
        studyMode.value = 'setup';
        studySwipeX.value = 0;
        studyShowAnswer.value = false;
        studyClock.stop();
        Session.clearResumePoint('study');
        refreshResume();
      }

      // ====== 手势处理器绑定（实现见 makeSwipe / studySwipe） ======
      const studyOnSwipeStart = studySwipe.onStart;
      const studyOnSwipeMove = studySwipe.onMove;
      const studyOnSwipeEnd = studySwipe.onEnd;

      // 当前练习页是不是这个模式（3.0：模式在练习页内部切换，不再是独立 tab）
      function modeActive(sessionMode) {
        if (activeTab.value !== 'practice') return false;
        const m = PRACTICE_MODES.find(x => x.key === practiceMode.value);
        return !!m && m.sessionMode === sessionMode;
      }

      // 多行/复合输入控件里，Enter 是用户的编辑键不是导航键：简答题 textarea 内
      // 回车要换行，选项下拉展开时 Enter 不能把焦点抢走。
      // 单行 input（填空作答）不在此列——那里 Enter→提交/下一题本来就是想要的。
      function isEditableTarget(e) {
        const el = e.target;
        if (!el || !el.tagName) return false;
        return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
      }

      // 浮层（确认对话框 / 「更多」抽屉 / AI 提示词）打开时，背景页的快捷键全部让路 ——
      // 否则在对话框里按 Enter 会把背后的卡翻过去，考试里按 Esc 会直接交卷。
      function overlayIsOpen() {
        return dialog.value !== null || showAiModal.value === true || showMoreSheet.value === true;
      }

      // 桌面端也支持：点击「记住了/还不会」按钮 或 键盘 1/2 或 ←/→
      function studyKeyDown(e) {
        if (isEditableTarget(e)) return;
        if (overlayIsOpen()) return;
        if (!modeActive('study')) return;
        if (studyMode.value !== 'running') return;
        if (e.key === ' ' || e.key === 'Enter') {
          if (!studyShowAnswer.value) { studyShowAnswer.value = true; e.preventDefault(); }
        } else if (studyShowAnswer.value) {
          if (e.key === 'ArrowLeft' || e.key === '1') { studyMark(false); e.preventDefault(); }
          else if (e.key === 'ArrowRight' || e.key === '2') { studyMark(true); e.preventDefault(); }
        }
      }

      // 格式化时长
      function studyFormatDuration(sec) {
        sec = sec || 0;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        if (m >= 60) {
          const h = Math.floor(m / 60);
          return h + 'h ' + (m % 60) + 'm';
        }
        return m + '分 ' + (s < 10 ? '0' : '') + s + 's';
      }

      // ====== setup 自动填充 custom end ======
      function studyAutoFillCustomEnd() {
        if (!studyCustomEnd.value || studyCustomEnd.value <= 0) {
          studyCustomEnd.value = bank.value.length || 500;
        }
      }

      /* ============ 阶段 3：练习模式（独立于学习/记忆闯关） ============ */
      // 核心差异：练习 = 自己作答 → 系统自动判分 → 看答案 → 下一题
      // 与学习/记忆闯关的区别：有"提交答案"步骤，客观题系统判分，主观题看答案后自评
      const exerciseMode = ref('setup');

      // setup 配置（复用 study 的范围逻辑，独立 ref 避免串状态）
      const exerciseScope = ref('all');
      const exerciseCustomStart = ref(1);
      const exerciseCustomEnd = ref(0);
      const exerciseStrategy = ref('random');    // 练习默认随机洗牌
      const exercisePerSession = ref('all');
      const exercisePerSessionCustom = ref(30);
      const exerciseTypes = ref({ single_choice: true, multi_choice: true, true_false: true, fill_blank: true, special_fill_blank: true, essay: true });

      // running 状态
      const exerciseQueueGids = ref([]);
      const exerciseIndex = ref(0);
      const exerciseStartAt = ref(0);

      // 每题作答
      const exerciseAnswerSubmitted = ref(false);
      const exerciseChoice = ref(null);       // 单选/判断
      const exerciseMultiSel = ref([]);       // 多选
      const exerciseInput = ref('');          // 简答
      const exerciseBlanks = ref([]);         // 填空/专项：逐空数组（§4.2 决策，界面不出现 |）
      const exerciseSelfResult = ref(null);   // 自评结果：null=未评

      // 每题判分结果
      const exerciseFeedback = ref(null);     // { correct: true/false, reveal: true }

      // summary 统计
      const exercisePassCount = ref(0);
      const exerciseFailCount = ref(0);
      const exerciseNewWrong = ref(0);
      const exerciseNewMastered = ref(0);
      const exerciseElapsedSec = ref(0);
      const exerciseClock = makeSessionTimer(exerciseElapsedSec, exerciseStartAt);

      // 手势：判完分后左右任意滑都进下一题（与学习模式不同，这里不分方向）
      const EXERCISE_SWIPE_THRESHOLD = 80;
      const exerciseSwipe = makeSwipe({
        enabled: () => exerciseMode.value === 'running' && exerciseAnswerSubmitted.value,
        onSwipe: x => { if (Math.abs(x) >= EXERCISE_SWIPE_THRESHOLD) exerciseNext(); }
      });
      const exerciseSwipeX = exerciseSwipe.x;
      const exerciseSwipeActive = exerciseSwipe.active;

      // computed
      const exerciseCurrentItem = computed(() => {
        const gid = exerciseQueueGids.value[exerciseIndex.value];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const exerciseNextItem = computed(() => {
        const gid = exerciseQueueGids.value[exerciseIndex.value + 1];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const exerciseTotal = computed(() => exerciseQueueGids.value.length);
      const exerciseProgressPct = computed(() => {
        if (!exerciseTotal.value) return 0;
        return Math.round((exerciseIndex.value / exerciseTotal.value) * 100);
      });
      const exerciseCurrentProgress = computed(() => {
        if (!exerciseTotal.value) return '0/0';
        return (exerciseIndex.value + 1) + '/' + exerciseTotal.value;
      });
      const exercisePrevHint = computed(() => {
        const gid = exerciseCurrentItem.value && exerciseCurrentItem.value.gid;
        if (!gid) return '';
        const e = Progress.get(gid);
        if (!e) return '之前：未学过';
        const parts = [];
        if (e.attempts > 0) parts.push('学过 ' + e.attempts + ' 次');
        if (e.status === 'mastered') parts.push('已掌握');
        else if (e.wrong > 0) parts.push('上次答错');
        return '之前：' + parts.join(' · ');
      });
      function exerciseCfg() {
        return {
          scope: exerciseScope.value, start: exerciseCustomStart.value, end: exerciseCustomEnd.value,
          types: exerciseTypes.value, strategy: exerciseStrategy.value,
          perSession: exercisePerSession.value, perSessionCustom: exercisePerSessionCustom.value
        };
      }
      const exerciseBadgeCount = computed(() => queueCountOf(exerciseCfg()));
      // 徽标要与实际排队口径一致：错题本范围取的是「本卷内的错题」，不是全部错题数
      const exerciseWrongbookCount = computed(() =>
        queueCountOf(Object.assign(exerciseCfg(), { scope: 'wrongbook' })));

      // 判分核心：本体在 js/judge.js（纯逻辑、可在 Node 单测）。
      // 学习/练习/模拟考试/分类考试共用这一份，§4.3 要求「不得产生第二套实现」，
      // 所以这里只转发，不在此处再写一遍分支。
      function judgeObjective(cur, choice, multiSel) {
        return Judge.judge(cur, choice, multiSel);
      }

      function resetExerciseAnswer() {
        exerciseChoice.value = null;
        exerciseMultiSel.value = [];
        exerciseInput.value = '';
        exerciseBlanks.value = [];
        exerciseSelfResult.value = null;
        exerciseAnswerSubmitted.value = false;
        exerciseFeedback.value = null;
      }

      // 逐空作答的显示文本与「已填」判定（§4.2：界面不出现分隔符，这里只为记录与展示）
      function blanksText(arr) {
        return (Array.isArray(arr) ? arr : []).map(s => String(s == null ? '' : s).trim()).filter(Boolean).join(' / ');
      }
      function blanksFilled(arr) {
        return (Array.isArray(arr) ? arr : []).some(s => String(s == null ? '' : s).trim().length > 0);
      }

      // ====== setup → running ======
      function exerciseStart() {
        if (!exerciseBadgeCount.value) { toast('当前条件下没有可练习的题目', false); return; }
        const queueGids = buildQueueGids(exerciseCfg());
        if (!queueGids.length) { toast('队列为空', false); return; }

        exerciseQueueGids.value = queueGids;
        exerciseIndex.value = 0;
        resetExerciseAnswer();
        exercisePassCount.value = 0;
        exerciseFailCount.value = 0;
        exerciseNewWrong.value = 0;
        exerciseNewMastered.value = 0;
        exerciseStartAt.value = Date.now();
        exerciseElapsedSec.value = 0;
        exerciseMode.value = 'running';

        // 恢复点
        Session.saveResumePoint({ bankId: bankIdOf(), paperId: currentPaperId.value, mode: 'exercise', queueGids: queueGids, currentIndex: 0 });

        exerciseClock.start();
      }

      function exerciseResume() {
        const rp = Session.loadResumePoint(bankIdOf(), 'exercise');
        if (!rp) return;
        exerciseQueueGids.value = rp.queueGids || [];
        exerciseIndex.value = rp.currentIndex || 0;
        resetExerciseAnswer();
        exercisePassCount.value = 0; exerciseFailCount.value = 0;
        exerciseNewWrong.value = 0; exerciseNewMastered.value = 0;
        exerciseStartAt.value = Date.now(); exerciseElapsedSec.value = 0;
        exerciseMode.value = 'running';
        exerciseClock.start();
      }

      // ====== running ======
      // 当前题能不能提交（§4.2：未作答直接提交按判错处理，不送分 —— 这里只拦「什么都没选」，
      // 不做「必须作答才能提交」以外的任何判断）
      const exerciseCanSubmit = computed(() => {
        const cur = exerciseCurrentItem.value;
        if (!cur) return false;
        if (cur.rawType === 'single_choice' || cur.rawType === 'true_false') return !!exerciseChoice.value;
        if (cur.rawType === 'multi_choice') return exerciseMultiSel.value.length > 0;
        if (cur.rawType === 'fill_blank' || cur.rawType === 'special_fill_blank') return blanksFilled(exerciseBlanks.value);
        if (cur.rawType === 'essay') return String(exerciseInput.value || '').trim().length > 0;
        // 未注册题型不提供作答控件（§4.2 DefaultRenderer：不判分、不写进度）
        return false;
      });
      // 未注册题型：有「跳过」，否则这一轮会死锁在本题（千题题库里混进一道未知题型很常见）
      const exerciseUnsupported = computed(() => {
        const cur = exerciseCurrentItem.value;
        return !!cur && !isRegisteredType(cur.rawType);
      });

      // 逐空作答 → 写回给判分与记录的「学生答案」文本（只用于展示与备份，不参与判分）
      function exerciseStudentAnswerText(cur) {
        if (!cur) return '';
        if (cur.rawType === 'fill_blank' || cur.rawType === 'special_fill_blank') return blanksText(exerciseBlanks.value);
        if (cur.rawType === 'essay') return exerciseInput.value;
        if (cur.rawType === 'multi_choice') return exerciseMultiSel.value.slice().sort().join('、');
        return exerciseChoice.value || '';
      }

      function exerciseSubmit() {
        const cur = exerciseCurrentItem.value;
        if (!cur || exerciseAnswerSubmitted.value) return;
        // 未注册的题型：不提供作答、不判分、不写进度（§4.2）
        if (Types && !Types.isRegistered(cur.rawType)) return;

        if (isObjective(cur.rawType)) {
          // 客观题：系统自动判分，判分口径仍是全局唯一的那一份 judgeObjective
          const correct = judgeObjective(cur, exerciseChoice.value, exerciseMultiSel.value);
          _exerciseRecord(cur, correct, exerciseStudentAnswerText(cur));
          exerciseFeedback.value = { correct: correct };
          exerciseAnswerSubmitted.value = true;
          // §4.3 前进行为：答对自动前进（0.6 秒是节奏控制，不是装饰动效，
          // reduced-motion 下也不取消）；答错必须停在本题直到用户看懂。
          if (correct) {
            clearTimeout(autoNextTimer);
            autoNextTimer = setTimeout(() => {
              if (exerciseMode.value === 'running' && exerciseAnswerSubmitted.value) exerciseNext();
            }, 600);
          }
        } else {
          // 主观题（填空/简答/专项）：不自动判分，先给参考答案，用户自评
          exerciseAnswerSubmitted.value = true;
        }
      }

      // 用户对主观题自评（答对/答错）
      function exerciseSelfJudge(correct) {
        const cur = exerciseCurrentItem.value;
        if (!cur || !exerciseAnswerSubmitted.value) return;
        exerciseSelfResult.value = correct;
        // 自评结果同时喂给共享的判分结果组件——界面只有一套结果展示（§4.3）
        _exerciseRecord(cur, correct, exerciseStudentAnswerText(cur));
        exerciseFeedback.value = { correct: correct };
      }

      // 内部：记录结果
      function _exerciseRecord(cur, correct, studentAnswer) {
        const prev = Progress.get(cur.gid);
        const prevStatus = prev ? prev.status : 'new';
        if (correct) {
          const e = Progress.markPass(cur.gid);
          exercisePassCount.value++;
          if (prevStatus !== 'mastered' && e && e.status === 'mastered') exerciseNewMastered.value++;
          // 3.0 §7.4.1：任何入口答对都计错题本的连对（2.x 这里什么都不做，
          // 于是「在答题模式里答对一道错题」永远不推进它的离开进度）
          _creditWrongbookCorrect(cur.gid);
        } else {
          Progress.markFail(cur.gid);
          exerciseFailCount.value++;
          Wrongbook.add(cur, 'exercise', studentAnswer, false);
          exerciseNewWrong.value++;
          loadWrongbook();
        }
        refreshProgress();
      }

      function exerciseNext() {
        if (exerciseIndex.value + 1 >= exerciseQueueGids.value.length) {
          exerciseFinish();
        } else {
          exerciseIndex.value++;
          resetExerciseAnswer();
          exerciseSwipeX.value = 0;
          Session.touchResumePoint(exerciseIndex.value, 'exercise');
        }
      }

      function exerciseFinish() {
        exerciseMode.value = 'summary';
        exerciseClock.stop();
        Session.clearResumePoint('exercise');
        refreshProgress();
      }

      function exerciseExit() {
        if (exerciseMode.value === 'running') {
          toast('已暂停，下次打开可继续', true);
          exerciseClock.stop();
          exerciseMode.value = 'setup';
          refreshResume();
          switchTab('today'); setTimeout(() => { switchTab('practice'); setPracticeMode('answer'); }, 50);
        } else {
          exerciseMode.value = 'setup';
        }
      }

      function exerciseRestart() {
        exerciseMode.value = 'setup';
        resetExerciseAnswer();
        exerciseSwipeX.value = 0;
        exerciseClock.stop();
        Session.clearResumePoint('exercise');
        refreshResume();
      }

      // 选项 / 多选
      function exerciseOptionClick(val) {
        if (exerciseAnswerSubmitted.value) return;
        const cur = exerciseCurrentItem.value;
        if (!cur) return;
        if (cur.rawType === 'single_choice' || cur.rawType === 'true_false') {
          exerciseChoice.value = val;
        } else if (cur.rawType === 'multi_choice') {
          const idx = exerciseMultiSel.value.indexOf(val);
          if (idx >= 0) exerciseMultiSel.value.splice(idx, 1);
          else exerciseMultiSel.value.push(val);
        }
      }
      function exerciseIsOptionOn(val) {
        return exerciseMultiSel.value.indexOf(val) >= 0;
      }

      // 手势处理器绑定（实现见 makeSwipe / exerciseSwipe）
      const exerciseOnSwipeStart = exerciseSwipe.onStart;
      const exerciseOnSwipeMove = exerciseSwipe.onMove;
      const exerciseOnSwipeEnd = exerciseSwipe.onEnd;

      // 键盘（§4.2 / 设计稿「键盘：1–9 选择 · Enter 提交 · ← 上一题」）
      // 数字键按选项在 A–Z 里的顺序映射：1→A、2→B……9→I。
      function pickByNumberKey(e, item, onPick) {
        if (!item || !item.options) return false;
        const n = parseInt(e.key, 10);
        if (!(n >= 1 && n <= 9)) return false;
        const keys = Object.keys(item.options);
        const k = keys[n - 1];
        if (!k) return false;
        e.preventDefault();
        onPick(k);
        return true;
      }

      function exerciseKeyDown(e) {
        if (isEditableTarget(e)) return;
        if (overlayIsOpen()) return;
        if (!modeActive('exercise')) return;
        if (exerciseMode.value !== 'running') return;
        const cur = exerciseCurrentItem.value;
        if (exerciseAnswerSubmitted.value) {
          // 答对是自动前进的；这里剩下的是「答错后看懂了再走」和「主观题自评后前进」
          if (e.key === 'Enter' || e.key === ' ') { clearTimeout(autoNextTimer); exerciseNext(); e.preventDefault(); }
          else if (e.key === '1' || e.key === '2') {
            if (!exerciseFeedback.value && cur && !isObjective(cur.rawType)) exerciseSelfJudge(e.key === '1');
          }
          return;
        }
        if (e.key === 'Enter') { exerciseSubmit(); e.preventDefault(); return; }
        if (cur && (cur.rawType === 'single_choice' || cur.rawType === 'multi_choice')) {
          pickByNumberKey(e, cur, k => {
            if (cur.rawType === 'single_choice') exerciseChoice.value = k;
            else {
              const i = exerciseMultiSel.value.indexOf(k);
              if (i >= 0) exerciseMultiSel.value.splice(i, 1); else exerciseMultiSel.value.push(k);
            }
          });
        } else if (cur && cur.rawType === 'true_false') {
          if (e.key === '1') { exerciseChoice.value = 'true'; e.preventDefault(); }
          else if (e.key === '2') { exerciseChoice.value = 'false'; e.preventDefault(); }
        }
      }

      function exerciseAutoFillCustomEnd() {
        if (!exerciseCustomEnd.value || exerciseCustomEnd.value <= 0) {
          exerciseCustomEnd.value = bank.value.length || 500;
        }
      }

      /* ============ 阶段 4：考试模式 ============ */
      // 核心差异：过程中不判分不显示答案，可回看改答，结束一次性判分
      const examMode = ref('setup');

      // setup（与 exercise 类似，默认 50 题随机洗牌）
      const examScope = ref('all');
      const examCustomStart = ref(1);
      const examCustomEnd = ref(0);
      const examStrategy = ref('random');
      const examPerSession = ref('50');
      const examPerSessionCustom = ref(100);
      const examTypes = ref({ single_choice: true, multi_choice: true, true_false: true, fill_blank: true, special_fill_blank: true, essay: true });

      // running
      const examQueueGids = ref([]);
      const examIndex = ref(0);
      const examStartAt = ref(0);
      const examElapsedSec = ref(0);
      const examClock = makeSessionTimer(examElapsedSec, examStartAt);
      // 核心：每题独立存答案（可随时回看改答）
      const examAnswers = reactive({});   // { [gid]: { choice, multiSel, input, answered: bool } }
      const examSubmitted = ref(false);   // 是否已交卷
      const examSheetOpen = ref(false);    // 移动端答题卡折叠开关

      // summary
      const examPassCount = ref(0);
      const examFailCount = ref(0);
      const examWrongItems = ref([]);     // [{ gid, item, userAnswer, isCorrect }]
      const examPendingItems = ref([]);   // 主观题已作答、待自评
      const examBlankItems = ref([]);     // 未作答：不计分、不写 progress、不进错题本

      // 正确率按「已判分」题数算：把待自评和未作答算进分母会系统性压低分数
      const examGradedCount = computed(() => examPassCount.value + examFailCount.value);
      const examScorePct = computed(() => {
        if (!examGradedCount.value) return 0;
        return Math.round((examPassCount.value / examGradedCount.value) * 100);
      });

      // 状态面板显示
      const examAnsweredCount = computed(() => {
        let c = 0;
        examQueueGids.value.forEach(g => { if (examAnswers[g] && examAnswers[g].answered) c++; });
        return c;
      });

      // computed
      const examCurrentItem = computed(() => {
        const gid = examQueueGids.value[examIndex.value];
        if (!gid) return null;
        return bank.value.find(it => it.gid === gid) || null;
      });
      const examTotal = computed(() => examQueueGids.value.length);
      const examProgressPct = computed(() => {
        if (!examTotal.value) return 0;
        return Math.round((examAnsweredCount.value / examTotal.value) * 100);
      });
      const examIndexLabel = computed(() => {
        if (!examTotal.value) return '0/0';
        return (examIndex.value + 1) + '/' + examTotal.value;
      });
      function examCfg() {
        return {
          scope: examScope.value, start: examCustomStart.value, end: examCustomEnd.value,
          types: examTypes.value, strategy: examStrategy.value,
          perSession: examPerSession.value, perSessionCustom: examPerSessionCustom.value
        };
      }
      const examBadgeCount = computed(() => queueCountOf(examCfg()));

      function _examGetAnswer(gid) {
        if (!examAnswers[gid]) examAnswers[gid] = { choice: null, multiSel: [], input: '', answered: false };
        return examAnswers[gid];
      }
      function _examMarkAnswered(gid) {
        const a = _examGetAnswer(gid);
        const item = bank.value.find(it => it.gid === gid);
        if (!item) { a.answered = false; return; }
        if (item.rawType === 'single_choice' || item.rawType === 'true_false') {
          a.answered = !!a.choice;
        } else if (item.rawType === 'multi_choice') {
          a.answered = a.multiSel.length > 0;
        } else {
          a.answered = !!a.input && a.input.trim() !== '';
        }
      }

      // setup → running
      function examStart() {
        if (!examBadgeCount.value) { toast('当前条件下没有可考试的题目', false); return; }
        const queueGids = buildQueueGids(examCfg());

        if (!queueGids.length) { toast('队列为空', false); return; }

        examQueueGids.value = queueGids;
        examIndex.value = 0;
        // 清空/初始化答案对象
        for (const k of Object.keys(examAnswers)) delete examAnswers[k];
        examPassCount.value = 0; examFailCount.value = 0;
        examWrongItems.value = []; examPendingItems.value = []; examBlankItems.value = [];
        examSubmitted.value = false;
        examStartAt.value = Date.now();
        examElapsedSec.value = 0;
        examMode.value = 'running';

        examClock.start();
        _examPersist();
      }

      // 把逐题答案 + 当前下标写回恢复点。只在跳题 / 选项变更 / 离开页面时写，
      // 不按键入次数写，避免手机上每秒反复序列化整份答案表。
      // startedAt 取内存里的 examStartAt：续答时它已由 examResume 还原成原开始时间。
      function _examPersist() {
        if (examMode.value !== 'running' || examSubmitted.value) return;
        Session.saveResumePoint({
          bankId: bankIdOf(),
          paperId: currentPaperId.value,
          mode: 'exam',
          queueGids: examQueueGids.value,
          currentIndex: examIndex.value,
          startedAt: new Date(examStartAt.value).toISOString(),
          answers: JSON.parse(JSON.stringify(examAnswers))
        });
      }

      function examResume() {
        const rp = Session.loadResumePoint(bankIdOf(), 'exam');
        if (!rp) return;
        examQueueGids.value = rp.queueGids || [];
        examIndex.value = rp.currentIndex || 0;
        for (const k of Object.keys(examAnswers)) delete examAnswers[k];
        Object.assign(examAnswers, rp.answers || {});
        examPassCount.value = 0; examFailCount.value = 0;
        examWrongItems.value = []; examPendingItems.value = []; examBlankItems.value = [];
        examSubmitted.value = false;
        const started = rp.startedAt ? Date.parse(rp.startedAt) : NaN;
        examStartAt.value = isNaN(started) ? Date.now() : started;
        examElapsedSec.value = Math.floor((Date.now() - examStartAt.value) / 1000);
        examMode.value = 'running';
        examClock.start();
      }

      function examJump(idx) {
        if (idx < 0 || idx >= examTotal.value) return;
        examIndex.value = idx;
        examSheetOpen.value = false; // 移动端跳题后自动折叠
        _examPersist();
      }
      function examPrev() { if (examIndex.value > 0) { examIndex.value--; _examPersist(); } }
      function examNext() { if (examIndex.value < examTotal.value - 1) { examIndex.value++; _examPersist(); } }

      // 选项点击（running 中随时可改）
      function examOptionClick(val) {
        const cur = examCurrentItem.value;
        if (!cur || examSubmitted.value) return;
        const a = _examGetAnswer(cur.gid);
        if (cur.rawType === 'single_choice' || cur.rawType === 'true_false') {
          a.choice = (a.choice === val) ? null : val;
        } else if (cur.rawType === 'multi_choice') {
          const idx = a.multiSel.indexOf(val);
          if (idx >= 0) a.multiSel.splice(idx, 1); else a.multiSel.push(val);
        }
        _examMarkAnswered(cur.gid);
        _examPersist();
      }
      function examIsOptionOn(val) {
        const cur = examCurrentItem.value;
        if (!cur) return false;
        const a = examAnswers[cur.gid];
        return a && a.multiSel.indexOf(val) >= 0;
      }

      // computed 代理：把 examAnswers[gid].input 暴露为可 v-model 的左值
      // Vue 模板 v-model 不能跟函数调用表达式（非 LValue），所以用 computed 桥接
      const examInputProxy = computed({
        get() {
          const cur = examCurrentItem.value;
          if (!cur) return '';
          const a = examAnswers[cur.gid];
          return a ? a.input : '';
        },
        set(val) {
          const cur = examCurrentItem.value;
          if (!cur) return;
          _examGetAnswer(cur.gid).input = val;
          _examMarkAnswered(cur.gid);
        }
      });
      // 同理：把 examAnswers[gid].choice 暴露为 computed 左值（模板 :class 里不能跟函数调用）
      const examChoiceProxy = computed({
        get() {
          const cur = examCurrentItem.value;
          if (!cur) return null;
          const a = examAnswers[cur.gid];
          return a ? a.choice : null;
        },
        set(val) {
          const cur = examCurrentItem.value;
          if (!cur) return;
          _examGetAnswer(cur.gid).choice = val;
          _examMarkAnswered(cur.gid);
        }
      });
      // 多选的逐题答案（考试过程中可回看改答，所以存进 examAnswers 而不是独立 ref）
      const examMultiSel = computed({
        get() {
          const cur = examCurrentItem.value;
          if (!cur) return [];
          const a = examAnswers[cur.gid];
          return a && Array.isArray(a.multiSel) ? a.multiSel : [];
        },
        set(val) {
          const cur = examCurrentItem.value;
          if (!cur) return;
          _examGetAnswer(cur.gid).multiSel = Array.isArray(val) ? val.slice() : [];
          _examMarkAnswered(cur.gid);
        }
      });
      /**
       * 填空题的逐空答案（§4.2）。
       * 2.x 存在这里的是一整条 `input` 字符串（多空用 | 手写分隔），
       * 读到旧恢复点/旧备份时按同一个分隔规则拆成逐空 —— 界面层从此不再出现分隔符，
       * 但历史数据不会因此丢答案。
       */
      const examBlanks = computed({
        get() {
          const cur = examCurrentItem.value;
          if (!cur) return [];
          const a = examAnswers[cur.gid];
          if (!a) return [];
          if (Array.isArray(a.blanks)) return a.blanks;
          if (a.input) {
            const split = Types && Types.splitBlankAnswers ? Types.splitBlankAnswers : (s => String(s).split(/[|｜]/));
            return split(a.input);
          }
          return [];
        },
        set(val) {
          const cur = examCurrentItem.value;
          if (!cur) return;
          const a = _examGetAnswer(cur.gid);
          a.blanks = Array.isArray(val) ? val.slice() : [];
          // 同步一份 join 后的 input：老代码路径（_examAnswerText、备份、错题记录）仍读它
          a.input = blanksText(a.blanks);
          _examMarkAnswered(cur.gid);
        }
      });

      function _examAnswerText(a) {
        if (!a) return '';
        if (Array.isArray(a.blanks) && a.blanks.some(s => String(s || '').trim())) return blanksText(a.blanks);
        if (a.input) return a.input;
        if (Array.isArray(a.multiSel) && a.multiSel.length) return a.multiSel.join('、');
        return a.choice || '';
      }

      // 交卷（结束 running → summary）
      // 三分法：客观题即时判分；主观题答了→转待自评（此刻不算错）；未答→不计分不入错题本
      // 确认走应用内对话框（§8：1024+ 交卷确认改对话框；正文点名题数与后果，§4.1）
      async function examSubmit() {
        if (examSubmitted.value) return;
        const blank = examQueueGids.value.filter(g => !(examAnswers[g] && examAnswers[g].answered));
        const ok = await openDialog({
          title: '确认交卷？',
          body: blank.length
            ? '还有 ' + blank.length + ' 题未作答。未作答的题不计分、不写入错题本、不更新记忆进度。交卷后判分不可撤回。'
            : '全部 ' + examQueueGids.value.length + ' 题已作答。交卷后客观题立即判分、主观题转入待自评，判分结果不可撤回。',
          okText: '交卷',
          cancelText: '再检查一下'
        });
        if (!ok) return;
        _finishExam(blank);
      }

      function _finishExam(blank) {
        let pass = 0, fail = 0;
        const wrong = [];
        const pending = [];
        examQueueGids.value.forEach(gid => {
          const item = bank.value.find(it => it.gid === gid);
          if (!item) return;
          const a = examAnswers[gid] || {};
          if (!a.answered) return;
          const shown = _examAnswerText(a);
          if (isObjective(item.rawType)) {
            if (judgeObjective(item, a.choice || null, a.multiSel || [])) {
              pass++;
              Progress.markPass(gid);
              // 3.0 §7.4.1：考试答对也计错题本连对
              _creditWrongbookCorrect(gid);
            } else {
              fail++;
              Progress.markFail(gid);
              Wrongbook.add(item, 'exam', shown, false);
              wrong.push({ gid, item, userAnswer: a, displayAnswer: shown, isCorrect: false, isObjective: true });
            }
          } else {
            pending.push({ gid, item, userAnswer: a, displayAnswer: shown, isCorrect: null, isObjective: false, subjective: true });
          }
        });
        examPassCount.value = pass;
        examFailCount.value = fail;
        examWrongItems.value = wrong;
        examPendingItems.value = pending;
        examBlankItems.value = blank.map(g => {
          const item = bank.value.find(it => it.gid === g);
          return { gid: g, item: item, userAnswer: examAnswers[g] || {}, displayAnswer: '' };
        }).filter(e => e.item);
        examSubmitted.value = true;
        loadWrongbook();      // 角标与来源计数即时刷新
        refreshProgress();

        // 计时停止
        examClock.stop();
        Session.clearResumePoint('exam');
        examMode.value = 'summary';
      }

      // 主观题自评：对齐分类考试的 catSelfJudge 语义
      function examSelfJudge(gid, correct) {
        const idx = examPendingItems.value.findIndex(e => e.gid === gid);
        if (idx < 0) return;
        const entry = examPendingItems.value[idx];
        examPendingItems.value.splice(idx, 1);
        if (correct) {
          examPassCount.value++;
          Progress.markPass(gid);
          _creditWrongbookCorrect(gid);   // §7.4.1：评定为答对同样计连对
        } else {
          examFailCount.value++;
          Progress.markFail(gid);
          Wrongbook.add(entry.item, 'exam', entry.displayAnswer || _examAnswerText(entry.userAnswer), false);
          entry.isCorrect = false;
          examWrongItems.value.push(entry);
          loadWrongbook();
        }
        refreshProgress();
      }

      // 退出 = 暂停：保留已答内容与恢复点，考试页会出现「继续上次」。
      // 此前这里是无确认直接清空整份答卷，手机上误点一下就全没了。
      function examExit() {
        examClock.stop();
        if (examAnsweredCount.value) {
          if (!confirm('考试尚未交卷，确定退出吗？\n已答内容会保留，可在考试页「继续上次」接着做。')) return;
          _examPersist();
        } else {
          Session.clearResumePoint('exam');
        }
        examMode.value = 'setup';
        refreshResume();
      }

      function examRestart() {
        examMode.value = 'setup';
        examPassCount.value = 0; examFailCount.value = 0;
        examWrongItems.value = []; examPendingItems.value = []; examBlankItems.value = [];
        examSubmitted.value = false;
        examIndex.value = 0;
        for (const k of Object.keys(examAnswers)) delete examAnswers[k];
        examClock.stop();
        Session.clearResumePoint('exam');
        refreshResume();
      }

      function examAutoFillCustomEnd() {
        if (!examCustomEnd.value || examCustomEnd.value <= 0) {
          examCustomEnd.value = bank.value.length || 500;
        }
      }

      // 键盘（考试中 Enter = 下一题，方便快速跳过；1–9 选选项）
      function examKeyDown(e) {
        if (isEditableTarget(e)) return;
        if (overlayIsOpen()) return;
        if (!modeActive('exam')) return;
        if (examMode.value !== 'running' || examSubmitted.value) return;
        if (e.key === 'Enter') { examNext(); e.preventDefault(); return; }
        if (e.key === 'ArrowLeft') { examPrev(); e.preventDefault(); return; }
        const cur = examCurrentItem.value;
        if (cur && (cur.rawType === 'single_choice' || cur.rawType === 'multi_choice')) {
          pickByNumberKey(e, cur, k => {
            const a = _examGetAnswer(cur.gid);
            if (cur.rawType === 'single_choice') a.choice = k;
            else {
              const arr = Array.isArray(a.multiSel) ? a.multiSel.slice() : [];
              const i = arr.indexOf(k);
              if (i >= 0) arr.splice(i, 1); else arr.push(k);
              arr.sort();
              a.multiSel = arr;
            }
            _examMarkAnswered(cur.gid);
          });
        } else if (cur && cur.rawType === 'true_false') {
          if (e.key === '1' || e.key === '2') {
            _examGetAnswer(cur.gid).choice = e.key === '1' ? 'true' : 'false';
            _examMarkAnswered(cur.gid);
            e.preventDefault();
          }
        }
      }

      // ====== 生命周期更新（把 examKeyDown 也加进去） ======
      // 下面的 onMounted / onBeforeUnmount 会覆盖这里，在生命周期块追加 exerciseKeyDown 监听

      // ====== 生命周期 ======
      onMounted(() => {
        window.addEventListener('keydown', studyKeyDown);
        window.addEventListener('keydown', exerciseKeyDown);
        window.addEventListener('keydown', examKeyDown);
        window.addEventListener('keydown', overlayKeyDown);
        // 刷新 / 关标签页前落一次考试答案，弥补「键入不即时写」的窗口
        window.addEventListener('beforeunload', _examPersist);
        window.addEventListener('hashchange', onHashChange);
        // 形态切换（折叠屏折叠/展开、浏览器窗口缩放）只改可见形态，不动任何状态
        updateFormFactor();
        window.addEventListener('resize', updateFormFactor);
        window.addEventListener('orientationchange', updateFormFactor);
        // 旧书签 / manifest 快捷方式落到对应的新入口 + 模式
        hydrateRouteFromHash();
      });
      onBeforeUnmount(() => {
        window.removeEventListener('keydown', studyKeyDown);
        window.removeEventListener('keydown', exerciseKeyDown);
        window.removeEventListener('keydown', examKeyDown);
        window.removeEventListener('keydown', overlayKeyDown);
        window.removeEventListener('resize', updateFormFactor);
        window.removeEventListener('orientationchange', updateFormFactor);
        window.removeEventListener('beforeunload', _examPersist);
        window.removeEventListener('hashchange', onHashChange);
        studyClock.stop();
        exerciseClock.stop();
        examClock.stop();
      });

      /* ============ AI 提示词（弹窗） ============ */
      const showAiModal = ref(false);

      // Esc 关闭最上层浮层（原生对话框的惯例）：先关对话框，再关模态，最后关「更多」抽屉
      function overlayKeyDown(e) {
        if (e.key !== 'Escape') return;
        if (dialog.value) { closeDialog(false); e.preventDefault(); }
        else if (showAiModal.value) { showAiModal.value = false; e.preventDefault(); }
        else if (showMoreSheet.value) { showMoreSheet.value = false; e.preventDefault(); }
      }
      const aiCopied = ref(false);

      /* ============ 计算属性 ============ */
      const papers = computed(() => currentBank.value.papers);
      const hasMultiplePapers = computed(() => papers.value.length > 1);
      const features = computed(() => currentBank.value.features || {});
      const totalQuestions = computed(() => bank.value.length);

      /* —— 阶段 0 新增：学习状态 & 统计 —— */
      // bankGids：所有题目的全局 id 数组
      const bankGids = computed(() => bank.value.map(it => it.gid).filter(Boolean));
      // progressMap：全部学习进度（读取 ExamProgress，用 progressTick 驱动刷新）
      const progressMap = computed(() => {
        progressTick.value; // 依赖信号
        return Progress.getAll();
      });
      // dashboard：首页聚合
      // 错题一律读 wrongEntries（Wrongbook.list()，即运行时唯一真相源 examWrongbook:v1）。
      // 之前读的是 examWrongbook:v2 —— 那只是 Migration 在加载题库时写的一次性快照，
      // 且 migrateWrongbook 幂等跳过，此后本次会话新增的错题永远进不去，
      // 导致首页「错题」与错题本角标对不上。
      const dashboard = computed(() => {
        progressTick.value;
        return Stats.buildDashboard({
          allGids: bankGids.value,
          progressMap: progressMap.value,
          wrongbookEntries: wrongEntries.value
        });
      });
      // dailyTask：今日任务生成
      const dailyTask = computed(() => {
        progressTick.value;
        if (!Session || !Session.generateDailyTask) return { queue: [], stats: {} };
        return Session.generateDailyTask(bankGids.value);
      });
      // 本周活跃天数（weekTrend 里 reviewed > 0 的天数）
      const weekActiveDays = computed(() => {
        const trend = dashboard.value && dashboard.value.weekTrend;
        if (!trend) return 0;
        return trend.filter(d => d.reviewed > 0).length;
      });
      const weekGoalDays = 5; // 每周目标 5 天（硬编码，后续可从 settings 读）
      // 恢复点存在 localStorage，不是响应式源；写入/清除后必须手动 bump 这个信号，
      // 否则 setup 页的「继续上次」横幅会一直读到缓存里的旧值。
      // 不复用 progressTick：它会让 dashboard + dailyTask 在每次跳题时全量重算。
      const resumeTick = ref(0);
      function refreshResume() { resumeTick.value++; }
      function resumeComputed(mode) {
        return computed(() => {
          progressTick.value;
          resumeTick.value;
          return Session.loadResumePoint(bankIdOf(), mode);
        });
      }
      const resumeStudy = resumeComputed('study');
      const resumeExercise = resumeComputed('exercise');
      const resumeExam = resumeComputed('exam');

      const navItems = computed(() => NAV_ITEMS.map(n => ({
        key: n.key, label: n.label, icon: n.icon,
        count: n.key === 'wrongbook' ? wrongCount.value
             : (n.key === 'today' ? todayDueCount.value : 0)
      })));
      // <360px 收为 3 栏；≥360px 恢复 4 栏直达（§5.3 唯一的取舍在这里）
      const visibleNavItems = computed(() => isNarrow.value ? NARROW_NAV : navItems.value);
      const isMoreActive = computed(() => isNarrow.value && (activeTab.value === 'wrongbook' || activeTab.value === 'bank'));

      // 练习页可见模式 = 全集 ∩ 旧 features 开关键名映射（§7.4.2）
      const practiceModes = computed(() => {
        const f = features.value;
        return PRACTICE_MODES.filter(m => Nav.modeVisibleByFeature(f, m));
      });
      /* practiceMode 必须始终是 practiceModes 里的一员。三个入口都可能把它写成不可见的模式：
         本地上次用过的模式、旧书签、manifest 快捷方式；而 features 是异步到达的（题库加载完
         才知道哪些模式被关掉）。所以夹取只写这一处，switchTab / hydrate / 启动各调用点不再各判一遍。 */
      function settlePracticeMode() {
        if (practiceModes.value.some(m => m.key === practiceMode.value)) return;
        practiceMode.value = practiceModes.value.length ? practiceModes.value[0].key : 'recite';
      }
      Vue.watch(() => features.value, settlePracticeMode);
      const practiceModeHint = computed(() => {
        const m = practiceModes.value.find(x => x.key === practiceMode.value);
        return m ? m.caliber : '';
      });
      function setPracticeMode(k) {
        if (!practiceModes.value.some(m => m.key === k)) return;
        practiceMode.value = k;
        localStorage.setItem('memo:practiceMode', k);
        writeHash(activeTab.value, k);
      }

      // 应用栏标题 = 当前入口名；练习页报的是模式名，不是「练习」
      const activeTabLabel = computed(() => {
        if (activeTab.value === 'practice') {
          const m = PRACTICE_MODES.find(x => x.key === practiceMode.value);
          return m ? m.label : '练习';
        }
        const n = NAV_ITEMS.find(x => x.key === activeTab.value);
        return (n && n.label) || 'MemoDeck';
      });

      // 2.x 的 tabs 被 applyNormalized / loadStart 用来校验 activeTab 值域，
      // 保留同名 computed，但值域换成 3.0 的四个一级入口。
      const tabs = computed(() => NAV_ITEMS.map(n => ({ key: n.key, label: n.label })));

      const practiceCfg = computed(() => (features.value.practice && features.value.practice.config) || {});
      // 默认文案不再带 emoji（§7.1 禁止 emoji 做图标：跨平台渲染不一致）。
      // 题库若在 config 里显式给了 passLabel/failLabel，仍然照用 —— 那是部署者的选择。
      const passLabel = computed(() => practiceCfg.value.passLabel || '记住了');
      const failLabel = computed(() => practiceCfg.value.failLabel || '没记住');
      const shufflePolicy = computed(() => practiceCfg.value.shuffle !== false);

      const practiceCard = computed(() => practiceQueue.value[0] ? practiceQueue.value[0].it : null);
      const practiceMastered = computed(() => totalQuestions.value - practiceQueue.value.length);
      const practiceProgress = computed(() => totalQuestions.value === 0 ? 0 : ((totalQuestions.value - practiceQueue.value.length) / totalQuestions.value) * 100);

      // 模板属性值里不能出现 > / <（HTML 解析与 CI 守卫都不允许），
      // 所以「按通过/失败比例选图标」这种带比较的表达式必须抽成 computed。
      const exerciseSummaryIcon = computed(() =>
        exerciseFailCount.value > exercisePassCount.value ? '#i-flame'
        : exerciseFailCount.value === 0 ? '#i-trophy' : '#i-category');

      const catCurrent = computed(() => catPool.value[catIndex.value] || null);
      const catNextLabel = computed(() => (catIndex.value + 1 < catStats.total) ? '下一题 →' : '查看成绩');
      const hasPrevCat = computed(() => catIndex.value > 0);
      const catTypes = computed(() => {
        const groups = Utils.groupBy(bank.value, it => it.rawType);
        return Object.keys(groups).map(rawType => ({
          rawType: rawType,
          label: groups[rawType][0].typeLabel,
          count: groups[rawType].length
        }));
      });
      const catAllSelected = computed(() => catTypes.value.length > 0 && catSelected.value.length === catTypes.value.length);

      const wrongCount = computed(() => wrongEntries.value.length);
      const wrongBySource = computed(() => {
        const g = Utils.groupBy(wrongEntries.value, e => e.source);
        const out = { all: wrongEntries.value };
        WRONG_SOURCES.forEach(s => { out[s.key] = g[s.key] || []; });
        return out;
      });
      // 只列真实有题的来源：5 个固定 Tab 在手机上会折成两行、且大多是 0
      const wrongSourceTabs = computed(() => WRONG_SOURCES
        .map(s => ({ key: s.key, label: s.label, count: wrongBySource.value[s.key].length }))
        .filter(s => s.count));
      const wrongFiltered = computed(() => {
        const list = wrongBySource.value[wrongTab.value];
        return list && list.length ? list : wrongEntries.value;
      });
      const wrongItems = computed(() => wrongFiltered.value.map(e => e.item));
      // v2：错题本状态分布（new / learning / weak）
      const wrongStatusDist = computed(() => {
        if (!wrongEntries.value.length) return { new: 0, learning: 0, weak: 0 };
        return Wrongbook.countByStatus();
      });

      const aiPrompt = computed(() => AIPrompt.PROMPT);

      /* ============================================================
       * 3.0 · 今日页数据（§5.1「今日」= 今天该学什么，单一焦点）
       * ============================================================ */
      // 每日目标：数据层从 2.x 就就绪（examSettings:v1.dailyTarget），只是界面看不见改不了。
      // §7.5 要求补齐 → 这里把它接出来，写入路径仍走 Session.updateSettings（键名与结构不变）。
      const dailyTargetN = ref(Session.getSettings().dailyTarget || 20);
      function saveDailyTarget() {
        const n = Math.max(1, Math.min(500, Number(dailyTargetN.value) || 20));
        dailyTargetN.value = n;
        Session.updateSettings({ dailyTarget: n });
        progressTick.value++;   // dailyTask 是 computed，靠这个信号重算
        toast('每日目标已设为 ' + n + ' 题', true);
      }
      async function editDailyTarget() {
        const ok = await openDialog({
          title: '修改每日目标',
          body: '每日目标是「今日任务」的出题上限：到期题优先，不够再用未掌握题补，补不满就按实际数量。当前 ' + dailyTargetN.value + ' 题。',
          okText: '改成 30 题',
          cancelText: '不改'
        });
        if (ok) { dailyTargetN.value = 30; saveDailyTarget(); }
      }

      const todayLabel = computed(() => {
        const d = new Date();
        const wk = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
        return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + wk;
      });
      // 今日到期（时间维度）与记忆四档（掌握维度）是两个维度，界面上写成包含关系而不是并列相加
      const todayOverdueCount = computed(() => dailyTask.value.stats ? (dailyTask.value.stats.due || 0) : 0);
      const todayDueCount = computed(() => (dailyTask.value.queue || []).length);
      const dueBreak = computed(() => dashboard.value.dueBreak || { fresh: 0, learning: 0, review: 0, total: 0 });
      const todayLearnedCount = computed(() => dashboard.value.todayReviewed || 0);
      const todayRemainingCount = computed(() => Math.max(0, dailyTargetN.value - todayLearnedCount.value));
      const todayProgressPct = computed(() => {
        const t = dailyTargetN.value || 1;
        return Math.min(100, Math.round(todayLearnedCount.value / t * 100));
      });
      // 预计用时：按 30 秒/题估（口径写在界面上，不当成精确承诺）
      const todayEtaMinutes = computed(() => Math.max(1, Math.ceil(todayDueCount.value * 30 / 60)));

      // 「开始学习」= 今日 → 练习的背诵模式，范围锁定今日复习
      function startToday() {
        switchTab('practice');
        setPracticeMode('recite');
        studyScope.value = 'today';
        studyStart();
      }
      // 「攻薄弱项」= 错题本发起的复习轮（重练/重考是错题本内的两种发起方式，不再是独立入口）
      function startWeakAttack() {
        if (!wrongItems.value.length) { toast('错题本是空的', false); return; }
        switchTab('practice');
        setPracticeMode('answer');
        exerciseScope.value = 'wrongbook';
        exerciseStart();
      }

      /* ============================================================
       * 3.0 · 恢复提示卡（§4.1 三段式 + §7.5「何时留下」）
       * ============================================================ */
      function relTime(iso) {
        if (!iso) return '上次';
        const t = new Date(iso).getTime();
        if (isNaN(t)) return '上次';
        const diff = Math.max(0, Date.now() - t);
        const min = Math.floor(diff / 60000);
        if (min < 1) return '刚刚';
        if (min < 60) return min + ' 分钟前';
        const hr = Math.floor(min / 60);
        if (hr < 24) return hr + ' 小时前';
        const day = Math.floor(hr / 24);
        if (day < 7) return day + ' 天前';
        const d = new Date(iso);
        return (d.getMonth() + 1) + '/' + d.getDate();
      }
      const MODE_LABEL = { study: '背诵', exercise: '答题', exam: '模拟考试' };
      const allResumes = computed(() => {
        progressTick.value;
        resumeTick.value;
        const out = [];
        ['study', 'exercise', 'exam'].forEach(m => {
          const r = Session.loadResumePoint(bankIdOf(), m);
          if (!r || !Array.isArray(r.queueGids) || !r.queueGids.length) return;
          out.push({
            mode: m,
            label: MODE_LABEL[m] || m,
            position: '第 ' + (Math.min((r.currentIndex || 0) + 1, r.queueGids.length) + '/' + r.queueGids.length) + ' 题',
            when: relTime(r.lastTouchedAt || r.startedAt)
          });
        });
        return out;
      });
      function resumeFrom(mode) {
        switchTab('practice');
        const m = PRACTICE_MODES.find(x => x.sessionMode === mode);
        if (m) setPracticeMode(m.key);
        if (mode === 'study') studyResume();
        else if (mode === 'exercise') exerciseResume();
        else if (mode === 'exam') examResume();
      }
      function dismissResume(mode) {
        Session.clearResumePoint(mode);
        refreshResume();
        toast('已放弃这次恢复点', true);
      }

      /* 「这道题的历史」（§5.4：平板/桌面独有）。组件是纯展示，数据必须在这里喂进去 ——
         props 漏接的后果不是报错，而是它永远显示「学过 0 次 / 尚未作答 / 不在错题本」：
         一块在每张 ≥768px 的屏幕上对用户说谎的卡片。 */
      function historyOf(item) {
        const gid = item && item.gid;
        if (!gid) return { entry: null, wrong: null };
        return {
          entry: (progressMap.value && progressMap.value[gid]) || null,
          wrong: wrongEntries.value.find(e => e.item && e.item.gid === gid) || null
        };
      }
      const exerciseHistory = computed(() => historyOf(exerciseCurrentItem.value));
      const catHistory = computed(() => historyOf(catCurrent.value));

      /* ============================================================
       * 3.0 · 作答状态层（§4.4 七种状态里的「正确 / 漏选 / 你选」三档）
       * 判断/单选/多选共用同一套映射，交卷后由它给选项块上色并给判定文字。
       * 工厂函数只接「取值的函数」，不接 ref —— 避免把 ComputedRef 当成题目对象读。
       * ============================================================ */
      function stdKeysOf(item) {
        if (!item) return [];
        if (item.rawType === 'multi_choice') return Array.isArray(item.answer) ? item.answer.slice().sort() : [];
        if (item.rawType === 'single_choice') return item.answer ? [String(item.answer)] : [];
        // 判断题的标准项取自判分模块（不是在这里再写一遍 !!answer）：
        // 漏了这一支会让「答对了」的判断题按钮被涂成红色（§4.4 正确/你选 两态搞反）
        if (item.rawType === 'true_false') return Judge.stdTfKeys(item);
        return [];
      }
      function makeOptionState(getItem, getPicked, getShown) {
        function clsFor(key) {
          const item = getItem();
          if (!item) return '';
          const picked = getPicked();
          const isPicked = Array.isArray(picked) ? picked.indexOf(key) >= 0 : picked === key;
          if (!getShown()) return isPicked ? 'selected' : '';
          const std = stdKeysOf(item);
          const isStd = std.indexOf(key) >= 0;
          if (isStd && isPicked) return 'correct';   // 你选的、且是正确答案
          if (isStd && !isPicked) return 'missed';   // 正确答案但你没选 → 漏选
          if (!isStd && isPicked) return 'wrong';    // 你选了但不对 → 你选
          return '';
        }
        function flagFor(key) {
          if (!getShown()) return '';
          const c = clsFor(key);
          if (c === 'correct') return getItem().rawType === 'multi_choice' ? '正确 · 已选' : '正确';
          if (c === 'missed') return '漏选';
          if (c === 'wrong') return '你选';
          return '';
        }
        return { cls: clsFor, flag: flagFor };
      }

      const _exPicked = () => {
        const cur = exerciseCurrentItem.value;
        if (!cur) return null;
        return cur.rawType === 'multi_choice' ? exerciseMultiSel.value : exerciseChoice.value;
      };
      const _exerciseState = makeOptionState(() => exerciseCurrentItem.value, _exPicked, () => exerciseAnswerSubmitted.value);
      const exerciseOptionState = _exerciseState.cls;
      const exerciseOptionFlag = _exerciseState.flag;

      const _catPicked = () => {
        const cur = catCurrent.value;
        if (!cur) return null;
        return cur.rawType === 'multi_choice' ? catMultiSel.value : catChoice.value;
      };
      // 自测：主观题揭示后还没有自评结果时，不给选项上色（没有「判对了」这件事）
      const _catShown = () => catRevealed.value && isObjective(catCurrent.value && catCurrent.value.rawType);
      const _catState = makeOptionState(() => catCurrent.value, _catPicked, _catShown);
      const catOptionState = _catState.cls;
      const catOptionFlag = _catState.flag;


      /* ============================================================
       * 3.0 · 统计三联格（§4.1）
       * ============================================================ */
      const studyTriplet = computed(() => ([
        { n: studyPassCount.value, label: '记住了', tone: 'ok' },
        { n: studyFailCount.value, label: '还不会', tone: 'no' },
        { n: studyNewMastered.value, label: '转为已掌握', tone: '' },
        { n: studyNewWrong.value, label: '进错题本', tone: 'no' }
      ]));
      const exerciseTriplet = computed(() => ([
        { n: exercisePassCount.value, label: '答对', tone: 'ok' },
        { n: exerciseFailCount.value, label: '答错', tone: 'no' },
        { n: exerciseNewWrong.value, label: '进错题本', tone: 'no' },
        { n: exerciseNewMastered.value, label: '转为已掌握', tone: '' }
      ]));
      const catTriplet = computed(() => ([
        { n: catStats.total, label: '总题数', tone: '' },
        { n: catStats.right, label: '答对', tone: 'ok' },
        { n: catStats.wrong, label: '答错', tone: 'no' },
        { n: catElapsed.value || '0 秒', label: '用时', tone: '' }
      ]));

      /* 按题型自测的实时进度与计时 */
      const catProgressPct = computed(() => catStats.total ? Math.round((catIndex.value / catStats.total) * 100) : 0);
      const catElapsedLive = computed(() => {
        if (catStage.value === 'done') return catElapsed.value;
        if (!catStartTime.value) return '0分 00s';
        return studyFormatDuration(Math.floor((Date.now() - catStartTime.value) / 1000));
      });

      /* ============================================================
       * 3.0 · 折叠屏 / 形态切换（§8）
       * 形态切换不丢状态：作答内容、计时、当前位置都在各自的 ref 与恢复点里，
       * 与屏幕尺寸无关，所以这里只做「可见性」而不做任何搬迁。
       * ============================================================ */
      function bucketOf(w) {
        if (w < 360) return 'narrow';
        if (w < 560) return 'phone';
        if (w < 768) return 'tablet-portrait';
        if (w < 1024) return 'tablet';
        if (w < 1440) return 'desktop';
        return 'wide';
      }
      function updateFormFactor() {
        const w = window.innerWidth || document.documentElement.clientWidth || 390;
        isNarrow.value = w < 360;
        isWide.value = w >= 1024;
        const twoCol = w >= 768;
        formFactor.value = twoCol ? '展开 · 双栏' : (w >= 560 ? '展开 · 单栏' : '折叠 · 单栏');
        const bucket = bucketOf(w);
        if (lastFormBucket && bucket !== lastFormBucket) {
          // 首次跨越形态边界才提示一次，之后静默（§8 规则 4）
          formHint.value = '形态已切换为「' + formFactor.value + '」，作答内容与计时已自动保留';
          clearTimeout(formHintTimer);
          formHintTimer = setTimeout(() => { formHint.value = ''; }, 3000);
        }
        lastFormBucket = bucket;
      }


      /* ============ 工具 ============ */
      function toast(msg, ok) {
        toastMsg.value = msg;
        toastOk.value = ok !== false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastMsg.value = ''; }, 2200);
      }
      function sourceLabel(s) {
        const hit = WRONG_SOURCES.find(x => x.key === s);
        return hit ? hit.label : s;
      }
      function makeEnvelope(source, url, data) {
        return { source, url: url || '', fetchedAt: new Date().toISOString(), data };
      }
      function sourceMetaDump(source) {
        // §7.1 禁止 emoji 做图标：来源标识只写文字，颜色与底色由 .src-badge 的语义档给
        const t = source.source;
        if (t === 'remote') sourceMeta.value = { label: '远程', cls: 'remote', url: source.url || '', detail: `URL：${source.url || '(未记录)'} · 读取于 ${source.fetchedAt || ''}` };
        else if (t === 'paste') sourceMeta.value = { label: '粘贴录入', cls: 'paste', url: '', detail: `手动录入 · 缓存于 ${source.fetchedAt || ''}` };
        else if (t === 'file') sourceMeta.value = { label: '本地文件', cls: 'local', url: '', detail: `文件导入 · 缓存于 ${source.fetchedAt || ''}` };
        else if (t === 'local') sourceMeta.value = { label: '本地缓存', cls: 'local', url: source.url || '', detail: (source.url ? `URL：${source.url} · ` : '') + `缓存于 ${source.fetchedAt || ''}` };
        else sourceMeta.value = { label: '内置示例题库', cls: 'default', url: '', detail: '应用内置的离线兜底数据，可直接开练；想换题库去「题库」页。' };
      }

      /* ============ 数据应用 ============ */
      function applyNormalized(normalized, source) {
        currentBank.value = normalized;
        currentPaperId.value = normalized.papers[0] ? String(normalized.papers[0].id) : '';
        rebuildBank();
        if (!tabs.value.some(t => t.key === activeTab.value)) {
          activeTab.value = (tabs.value[0] && tabs.value[0].key) || 'home';
        }
        sourceMetaDump(source);
        dataError.value = '';
        catSelected.value = [];
        loadWrongbook();
        // 阶段 0 新增：数据到位后跑一次性迁移 + 刷新统计
        try { Migration.runAll(normalized); } catch (e) { /* 迁移失败不阻塞应用 */ }
        refreshProgress();
      }

      function rebuildBank() {
        bank.value = Core.buildItems(currentBank.value, currentPaperId.value);
        resetPractice(); // 数据变化时总是重置练习队列，避免切卷残留旧队列
        // 阶段 0 新增：切卷后刷新统计
        refreshProgress();
      }

      function switchPaper() {
        rebuildBank();
        catSelected.value = [];
        catStage.value = 'setup';   // 重置分类考试
        catPool.value = [];
        catWrongItems.value = [];
        Object.keys(previewRevealed).forEach(k => delete previewRevealed[k]); // 清空摸底速览的查看状态
      }

      /* ============ 数据加载（优先级：缓存 > data.json > 内置兜底） ============ */
      async function loadStart() {
        Store.clearLegacyCache();
        const cached = Store.readCache();
        if (cached && cached.data) {
          try {
            const normalized = Core.normalizeBank(cached.data);
            currentBank.value = normalized;
            currentPaperId.value = normalized.papers[0] ? String(normalized.papers[0].id) : '';
            rebuildBank();
            if (!tabs.value.some(t => t.key === activeTab.value)) activeTab.value = (tabs.value[0] && tabs.value[0].key) || 'home';
            sourceMetaDump({ source: 'local', url: cached.url, fetchedAt: cached.fetchedAt });
            remoteUrl.value = cached.url || '';
            loadWrongbook();
            // 阶段 0 新增：迁移 + 刷新
            try { Migration.runAll(normalized); } catch (e) { /* */ }
            refreshProgress();
            return { via: 'cache' };
          } catch (e) { Store.clearCache(); }
        }
        try {
          const res = await fetch(DEFAULT_REMOTE_URL, { cache: 'no-store' });
          if (res.ok) {
            const data = JSON.parse(await res.text());
            const normalized = Core.normalizeBank(data);
            applyNormalized(normalized, makeEnvelope('remote', DEFAULT_REMOTE_URL, data));
            Store.writeCache(makeEnvelope('remote', DEFAULT_REMOTE_URL, data));
            return { via: 'remote' };
          }
        } catch (e) { /* file:// 或 CORS 不可用则走兜底 */ }
        if (global.DEFAULT_BANK) {
          const normalized = Core.normalizeBank(global.DEFAULT_BANK);
          applyNormalized(normalized, makeEnvelope('default', '', global.DEFAULT_BANK));
          return { via: 'default' };
        }
        sourceMeta.value = { label: '❌ 无数据', cls: 'default', url: '', detail: '未找到数据，请导入 JSON。' };
      }

      /* ============ 导入 / 导出 ============ */
      async function fetchUrl() {
        const url = (remoteUrl.value || '').trim();
        if (!url) { dataError.value = '请先输入远程 JSON 链接。'; return; }
        dataError.value = '';
        dataBusy.value = true;
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = JSON.parse(await res.text());
          const normalized = Core.normalizeBank(data);
          applyNormalized(normalized, makeEnvelope('remote', url, data));
          Store.writeCache(makeEnvelope('remote', url, data));
          toast('远程导入成功');
        } catch (e) { dataError.value = '远程导入失败：' + e.message; }
        finally { dataBusy.value = false; }
      }

      /* ============ 数据备份 & 恢复 ============ */
      function doExportBackup() {
        if (!global.ExamBackup) { toast('备份模块未加载', false); return; }
        try {
          var payload = global.ExamBackup.exportBackup();
          var keys = Object.keys(payload.storage).length;
          toast('已导出备份：' + keys + ' 个数据键', true);
        } catch (e) {
          toast('导出失败：' + e.message, false);
        }
      }

      function onImportBackup(evt) {
        var file = evt.target.files && evt.target.files[0];
        if (!file) return;
        // reset so picking the same file again triggers change
        evt.target.value = '';
        if (!global.ExamBackup) { toast('备份模块未加载', false); return; }
        var msg = '导入方式：\n[合并] 只覆盖备份中有数据的项，保留现有其它数据\n[覆盖] 先清空全部数据再写入备份\n\n是否继续？';
        var mode = confirm(msg + '\n\n点"确定"=合并，点"取消"=再给你一次选择机会') ? 'merge' : null;
        if (mode === null) {
          mode = confirm('确定要用 [覆盖] 模式吗？这会先清空所有数据！') ? 'replace' : null;
        }
        if (!mode) return;
        global.ExamBackup.importBackup(file, { mode: mode }).then(function (r) {
          toast(r.msg, r.ok);
          // 旧备份导入时把「按旧口径进来了什么」讲清楚，不要只报一个成功数
          if (r.notes && r.notes.length) {
            setTimeout(function () { toast(r.notes[0], true); }, 2400);
          }
          if (r.ok) {
            progressTick.value++;
            refresh();
          }
        }).catch(function (e) {
          toast('导入失败：' + (e && e.msg ? e.msg : e.message), false);
        });
      }

      function doClearAll() {
        if (!confirmClearAll.value) {
          confirmClearAll.value = true;
          setTimeout(function () { confirmClearAll.value = false; }, 5000);
          return;
        }
        confirmClearAll.value = false;
        if (!confirm('⚠️ 确定要清空所有数据吗？\n这将删除题库、学习进度、错题本等全部数据。\n\n此操作不可撤销（除非你之前导出过备份）。')) return;
        if (!global.ExamBackup) return;
        var removed = global.ExamBackup.clearAll();
        toast('已清空 ' + removed.length + ' 个数据键，请重新导入题库', true);
        progressTick.value++;
        refresh();
      }

      async function refresh() {
        if (sourceMeta.value.url && sourceMeta.value.cls === 'remote') {
          remoteUrl.value = sourceMeta.value.url;
          await fetchUrl();
        } else if (Store.readCache() && Store.readCache().url) {
          remoteUrl.value = Store.readCache().url;
          await fetchUrl();
        } else {
          dataError.value = '当前来源没有可刷新的远程地址。可先「清空缓存并重载」再远程导入。';
        }
      }

      function applyPaste() {
        const text = (pasteText.value || '').trim();
        if (!text) { dataError.value = '粘贴内容为空。'; return; }
        try {
          const data = JSON.parse(text);
          const normalized = Core.normalizeBank(data);
          applyNormalized(normalized, makeEnvelope('paste', '', data));
          Store.writeCache(makeEnvelope('paste', '', data));
          pasteText.value = '';
          toast('粘贴导入成功');
        } catch (e) { dataError.value = '粘贴解析失败：' + e.message; }
      }

      function clearAndReload() {
        Store.clearCache();
        dataError.value = '';
        toast('已清空缓存');
        loadStart();
      }

      function onDragOver(e) { e.preventDefault(); dragActive.value = true; }
      function onDragLeave(e) { e.preventDefault(); dragActive.value = false; }
      function onDrop(e) {
        e.preventDefault();
        dragActive.value = false;
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) readFile(file);
      }
      function onFileChange(e) {
        const file = e.target.files && e.target.files[0];
        if (file) readFile(file);
        e.target.value = '';
      }
      function readFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            const normalized = Core.normalizeBank(data);
            applyNormalized(normalized, makeEnvelope('file', '', data));
            Store.writeCache(makeEnvelope('file', '', data));
            toast('已导入：' + file.name);
          } catch (err) { dataError.value = '文件解析失败：' + err.message; }
        };
        reader.onerror = () => { dataError.value = '文件读取失败。'; };
        reader.readAsText(file);
      }

      function serializeBank() {
        return {
          view: 'exam-bank',
          viewVersion: (window.MEMODECK_VERSION && window.MEMODECK_VERSION.VIEW) || '1.0.0',
          meta: currentBank.value.meta || {},
          features: currentBank.value.features || {},
          papers: currentBank.value.papers || []
        };
      }

      function downloadCurrent() {
        const blob = new Blob([JSON.stringify(serializeBank(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = ((currentBank.value.meta && currentBank.value.meta.title) || 'exam-bank') + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
      }

      async function copyCurrent() {
        const text = JSON.stringify(serializeBank(), null, 2);
        try {
          await navigator.clipboard.writeText(text);
          toast('已复制当前题库 JSON 到剪贴板');
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); toast('已复制到剪贴板'); }
          catch (e2) { dataError.value = '复制失败，请手动复制。'; }
          document.body.removeChild(ta);
        }
      }

      function downloadRules() {
        fetch('./docs/EXAM_JSON_SPEC.md', { cache: 'no-store' })
          .then(r => { if (!r.ok) throw new Error('not found'); return r.text(); })
          .then(text => saveText('MemoDeck-JSON规则.md', text))
          .catch(() => saveText('MemoDeck-JSON规则.md', global.FALLBACK_RULES || ''));
      }
      function saveText(fileName, text) {
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
      }

      /* ============ 导航切换与 hash 兼容 ============ */
      // manifest.json 声明过 #/study #/practice #/wrongbook 三个入口，2.x 从不读 hash，
      // 三个快捷方式都只会打开首页。3.0 换了导航结构，但**旧 hash 必须继续可达**：
      // 用户存的书签、部署方写死的入口链接都属于数据兼容范围。
      // 新格式：#/today  #/practice/<mode>  #/wrongbook  #/bank
      // 旧格式：#/home #/study #/exercise #/category #/exam #/preview #/practice #/wrongbook
      function parseHash() { return Nav.parseHash(location.hash); }
      function writeHash(tab, mode) {
        const want = Nav.formatHash(tab, mode);
        if (want && location.hash !== want) location.hash = want;   // hashchange 回调里值已相等，不成环
      }
      function switchTab(k) {
        if (!NAV_ITEMS.some(n => n.key === k)) return;
        activeTab.value = k;
        if (k === 'practice') {
          settlePracticeMode();          // 被旧开关关掉的模式不能停在原地
          writeHash('practice', practiceMode.value);
        } else {
          writeHash(k);
        }
        if (k === 'wrongbook') loadWrongbook();
        if (k === 'today') refreshProgress();
      }
      function onHashChange() {
        const r = parseHash();
        if (!r) return;
        if (r.tab !== activeTab.value) activeTab.value = r.tab;
        if (r.mode && r.mode !== practiceMode.value && practiceModes.value.some(m => m.key === r.mode)) {
          practiceMode.value = r.mode;
        }
      }
      // 应用启动时把 URL 里的入口读出来（旧书签落到对应的新入口 + 模式）
      function hydrateRouteFromHash() {
        const r = parseHash();
        if (!r) return;
        activeTab.value = r.tab;
        // 模式过可见性门：被 features 关掉的模式 + 一条旧书签，会落进分段控件里
        // 根本不存在的模式（界面显示着它，模式条却没有任何选中项）。features 后到时
        // 由 settlePracticeMode 兜住。
        if (r.mode && practiceModes.value.some(m => m.key === r.mode)) practiceMode.value = r.mode;
        settlePracticeMode();
      }

      function setTheme(mode) { themeMode.value = mode; applyTheme(); }

      /* ============ 通用确认对话框（§4.1 不可逆确认） ============ */
      // 交卷确认、清空全部数据、手动删除错题都用同一个组件，
      // 正文必须点名对象与后果——「确定吗」不算确认。
      function openDialog(opts) {
        return new Promise(resolve => { dialog.value = Object.assign({}, opts, { resolve }); });
      }
      function closeDialog(ok) {
        const d = dialog.value;
        dialog.value = null;
        if (d && d.resolve) d.resolve(!!ok);
      }

      /* ============ 记忆闯关（Leitner） ============ */
      function resetPractice() {
        const source = shufflePolicy.value ? Utils.shuffle(bank.value) : bank.value.slice();
        practiceQueue.value = Leitner.createQueue(source);
        practiceShowAnswer.value = false;
      }
      function mark(remembered) {
        const cur = practiceCard.value;
        if (remembered) {
          Leitner.markPass(practiceQueue.value);
          // 阶段 0 新增：写入 progress store
          if (cur && cur.gid) Progress.markPass(cur.gid);
          // 3.0 §7.4.1：闯关答对也计错题本连对。
          // 注意「本轮攻克」只是队列内的位置变化，不写跨会话状态（§7.3 消歧）
          if (cur) _creditWrongbookCorrect(cur.gid);
        } else {
          Leitner.markFail(practiceQueue.value);
          // 没记住：立即加入错题本（全局去重），实时刷新角标
          if (cur) {
            Wrongbook.add(cur, 'practice', null, false);
            loadWrongbook();
          }
          // 阶段 0 新增：写入 progress store
          if (cur && cur.gid) Progress.markFail(cur.gid);
        }
        // 阶段 0 新增：刷新统计
        refreshProgress();
        practiceShowAnswer.value = false;
      }

      /* ============ 摸底速览 ============ */
      function togglePreview(index) {
        if (previewRevealed[index]) delete previewRevealed[index];
        else previewRevealed[index] = true;
      }
      function addPreviewToWrongbook(item) {
        if (Wrongbook.add(item, 'preview', null, null)) toast('已加入错题本');
        else toast('该题已在错题本中', false);
      }

      /* ============ 分类考试 ============ */
      function toggleCatType(t) {
        const i = catSelected.value.indexOf(t);
        if (i >= 0) catSelected.value.splice(i, 1);
        else catSelected.value.push(t);
        catError.value = '';
      }
      function selectAllTypes() {
        catSelected.value = catAllSelected.value ? [] : catTypes.value.map(t => t.rawType);
      }
      function startCat() {
        if (!catSelected.value.length) { catError.value = '请至少选择一种题型。'; return; }
        let pool = bank.value.filter(it => catSelected.value.includes(it.rawType));
        if (!pool.length) { catError.value = '所选题型没有题目。'; return; }
        catPool.value = Utils.shuffle(pool);
        catIndex.value = 0;
        catStats.total = pool.length;
        catStats.right = 0;
        catStats.wrong = 0;
        catWrongItems.value = [];
        catStage.value = 'test';
        catFromWrongbook.value = false;
        catSnapshots.value = {};
        catStartTime.value = Date.now();
        catElapsed.value = '';
        catError.value = '';
        resetCatAnswer();
      }
      function resetCatAnswer() {
        catInput.value = '';
        catChoice.value = null;
        catMultiSel.value = [];
        catBlanks.value = [];
        catRevealed.value = false;
        catFeedback.value = null;
      }
      // 填空题多空答案：在光标处插入分隔符「|」，免去手动输入
      // 3.0：填空题改为逐空输入（§4.2），「在光标处插入 | 分隔符」这条路已经不存在了，
      // 配套的 insertCatSep / catFillInput 一并删除——留着就是一个没人读的按钮。
      function isObjective(rawType) {
        return Judge.isObjective(rawType);   // 口径唯一，见 js/judge.js
      }
      function isRegisteredType(rawType) {
        return Types.isRegistered(rawType);  // 六种已注册题型；其余走只读兜底
      }
      function catSubmit() {
        const cur = catCurrent.value;
        if (!cur || catRevealed.value) return;
        if (isObjective(cur.rawType)) {
          finishCatAnswer(judgeObjective(cur, catChoice.value, catMultiSel.value));
        } else {
          catRevealed.value = true; // 主观题：揭示答案，等待自评
        }
      }
      function finishCatAnswer(correct) {
        catRevealed.value = true;
        catFeedback.value = { correct: correct };
        const cur = catCurrent.value;
        if (correct) {
          catStats.right++;
          // 3.0 §7.4.1：**删除了「来自错题本、答对 1 次即移出」的短路**。
          // 原来 catFromWrongbook 为真时直接 Wrongbook.removeByItem，
          // 于是「错题重考」成了一条比日常复习更宽松的离开通道，
          // 同一道题换个入口就能一次出本。现在所有入口都只走 creditCorrectByGid。
          if (cur) {
            Progress.markPass(cur.gid);
            _creditWrongbookCorrect(cur.gid);
          }
          refreshProgress();
          // 答对：短暂展示结果后自动进入下一题（0.6 秒是节奏控制，reduced-motion 也保留）
          clearTimeout(autoNextTimer);
          autoNextTimer = setTimeout(() => {
            if (catStage.value === 'test') catNext();
          }, 600);
        } else {
          catStats.wrong++;
          catWrongItems.value.push(cur);
          if (cur) Progress.markFail(cur.gid);
          // 答错：实时加入错题本（全局去重，跨来源），无需等考试结束即可见
          if (cur) Wrongbook.add(cur, 'exam', null, false);
          refreshProgress();
          loadWrongbook();
        }
      }
      function catSelfJudge(correct) {
        if (catRevealed.value && !catFeedback.value) finishCatAnswer(correct);
      }
      function catNext() {
        snapshotCat();
        if (catIndex.value + 1 < catPool.value.length) {
          catIndex.value++;
          restoreCat();
        } else {
          catStage.value = 'done';
          const sec = Math.floor((Date.now() - catStartTime.value) / 1000);
          const m = Math.floor(sec / 60), s = sec % 60;
          catElapsed.value = m > 0 ? (m + ' 分 ' + s + ' 秒') : (s + ' 秒');
          // 错题已在答题瞬间实时入库（finishCatAnswer），这里仅刷新一次视图
          loadWrongbook();
        }
      }
      function catPrev() {
        if (catIndex.value <= 0) return;
        clearTimeout(autoNextTimer); // 回看时取消可能存在的自动前进
        snapshotCat();
        catIndex.value--;
        restoreCat();
      }
      function snapshotCat() {
        catSnapshots.value[catIndex.value] = {
          input: catInput.value,
          choice: catChoice.value,
          multiSel: catMultiSel.value.slice(),
          blanks: catBlanks.value.slice(),
          revealed: catRevealed.value,
          feedback: catFeedback.value
        };
      }
      function restoreCat() {
        const s = catSnapshots.value[catIndex.value];
        if (s) {
          catInput.value = s.input;
          catChoice.value = s.choice;
          catMultiSel.value = s.multiSel.slice();
          // 旧快照（2.x 存的）没有 blanks —— 缺失时按 undefined → 空数组，不报错
          catBlanks.value = Array.isArray(s.blanks) ? s.blanks.slice() : [];
          catRevealed.value = s.revealed;
          catFeedback.value = s.feedback;
        } else {
          resetCatAnswer();
        }
      }
      function toggleCatMulti(opt) {
        const i = catMultiSel.value.indexOf(opt);
        if (i >= 0) catMultiSel.value.splice(i, 1);
        else catMultiSel.value.push(opt);
      }
      function catOptionClick(k) {
        if (catRevealed.value) return;
        if (catCurrent.value && catCurrent.value.rawType === 'single_choice') catChoice.value = k;
        else toggleCatMulti(k);
      }
      function isCatOptionOn(k) {
        if (!catCurrent.value) return false;
        return catCurrent.value.rawType === 'single_choice' ? catChoice.value === k : catMultiSel.value.includes(k);
      }
      function catRestart() {
        clearTimeout(autoNextTimer);
        catStage.value = 'setup';
        catPool.value = [];
        catWrongItems.value = [];
        catSnapshots.value = {};
        catElapsed.value = '';
      }
      function parseOptions(text) {
        const opts = {};
        (text || '').split('\n').forEach(line => {
          const m = line.match(/^\s*([A-Za-z])\s*[.、:：]\s*(.+)$/);
          if (m) opts[m[1].toUpperCase()] = m[2].trim();
        });
        return opts;
      }
      function addCustomQuestion() {
        const f = customForm;
        if (!f.question.trim()) { catError.value = '请输入题干。'; return; }
        const q = { id: Date.now(), type: f.type, question: f.question.trim(), group: Core.TYPE_REGISTRY[f.type] ? Core.TYPE_REGISTRY[f.type].label : f.type };
        if (f.type === 'fill_blank' || f.type === 'special_fill_blank') {
          q.blanks = f.answer.split(/[|｜]/).map(s => s.trim()).filter(Boolean).map((a, i) => ({ index: i + 1, answer: a }));
        } else if (f.type === 'true_false') {
          q.answer = /对|正确|√|true/i.test(f.answer);
        } else if (f.type === 'single_choice') {
          q.options = parseOptions(f.options);
          q.answer = f.answer.trim().toUpperCase();
        } else if (f.type === 'multi_choice') {
          q.options = parseOptions(f.options);
          q.answer = f.answer.split(/[,，\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
        } else {
          q.answer = f.answer.trim();
        }
        const paper = currentBank.value.papers.find(p => String(p.id) === String(currentPaperId.value));
        if (paper) paper.questions.push(q);
        else currentBank.value.papers.push({ id: '自定义', name: '自定义卷', questions: [q] });
        rebuildBank();
        if (!catSelected.value.includes(q.type)) catSelected.value.push(q.type);
        catError.value = '';
        customForm.question = ''; customForm.answer = ''; customForm.options = '';
        toast('已添加题目');
      }

      /* ============ 错题本 ============ */
      function loadWrongbook() {
        wrongEntries.value = Wrongbook.list();
      }

      /**
       * 3.0 §7.4.1 错题离开规则的唯一落点。
       *
       * 2.x 有三条并行规则：重练连对 3 次移出、重考答对 1 次即移出、其它入口答对不计次。
       * 现在收敛成一条——**任何入口答对都计连对，累计 3 次自动移出，并告知原因**。
       * 所有模式（背诵/答题/自测/考试/闯关/错题练习）答对时都调这一个函数，
       * 不在错题本里的题它自己会 no-op（绝不因为答对一道没错过的题而造一条错题记录）。
       */
      function _creditWrongbookCorrect(gid) {
        if (!gid || !Wrongbook.creditCorrectByGid) return;
        const r = Wrongbook.creditCorrectByGid(gid);
        loadWrongbook();
        if (r.removed) toast('这道题累计连对 3 次，已自动移出错题本', true);
        else if (r.recorded && r.streak === 2) toast('连对 2 次 · 状态转为「模糊」，再答对 1 次即移出', true);
      }

      function wrongRemove(id, reason) {
        Wrongbook.remove(id, reason || '手动删除');
        loadWrongbook();
        toast('已手动删除这道错题', true);
      }
      function wrongMarkMastered(id) {
        if (!Wrongbook.markCleared) return;
        Wrongbook.markCleared(id);
        loadWrongbook();
        refreshProgress();
        toast('已标记为「已攻克」并移出错题本（原因记为手动标记）', true);
      }
      function wbToggle(id) { wbOpen[id] = !wbOpen[id]; }
      async function askRemoveWrong(e) {
        const q = String((e.item && (e.item.question || e.item.q)) || '').slice(0, 40);
        const ok = await openDialog({
          title: '删除这道错题？',
          body: '将从错题本移除「' + q + (String(e.item && (e.item.question || e.item.q) || '').length > 40 ? '…' : '') + '」，删除原因会记为「手动删除」。学习进度不受影响。',
          okText: '删除',
          danger: true
        });
        if (ok) wrongRemove(e.id, '手动删除');
      }
      async function askClearWrongbook() {
        const ok = await openDialog({
          title: '清空整个错题本？',
          body: '将删除全部 ' + wrongCount.value + ' 条错题记录。跨会话的记忆进度（新题/学习中/需复习/已掌握）不受影响。此操作不可撤销——除非你之前导出过备份。',
          okText: '确认清空',
          danger: true
        });
        if (ok) { wrongClear(); toast('已清空错题本（原因记为「用户手动清空」）', true); }
      }
      function wrongClear(source) {
        Wrongbook.clear(source);
        loadWrongbook();
      }
      function startWrongPractice(items) {
        if (!items.length) return;
        wrongPracticeQueue.value = Leitner.createQueue(items);
        wrongPracticeShow.value = false;
      }
      function wrongMark(remembered) {
        const cur = wrongPracticeQueue.value[0];
        const curItem = cur && cur.it;
        if (remembered) {
          // ✅ v2：调 Wrongbook.markCorrect 推进状态机（累计连对 3 次自动移出）
          const wbEntries = Wrongbook.list();
          const entry = curItem && curItem.gid
            ? wbEntries.find(e => e.gid === curItem.gid)
            : null;
          if (entry) {
            const result = Wrongbook.markCorrect(entry.id);
            // §7.4.1：移出时必须告知原因，文案由数据层返回的 reason 给，不在界面重写成第二套口径
            if (result.removed) toast('这道题' + (result.reason || '累计连对 3 次') + '，已移出错题本', true);
            loadWrongbook();
          }
          // Leitner 队列仍然前移
          Leitner.markPass(wrongPracticeQueue.value);
          if (curItem && curItem.gid) Progress.markPass(curItem.gid);
        } else {
          // ❌ 没记住
          const wbEntries = Wrongbook.list();
          const entry = curItem && curItem.gid
            ? wbEntries.find(e => e.gid === curItem.gid)
            : null;
          if (entry) {
            Wrongbook.markWrong(entry.id); // 状态机归零
            loadWrongbook();
          }
          Leitner.markFail(wrongPracticeQueue.value);
          if (curItem && curItem.gid) Progress.markFail(curItem.gid);
        }
        refreshProgress();
        wrongPracticeShow.value = false;
      }
      function startWrongExam(items) {
        if (!items.length) return;
        catPool.value = Utils.shuffle(items);
        catIndex.value = 0;
        catStats.total = items.length;
        catStats.right = 0;
        catStats.wrong = 0;
        catWrongItems.value = [];
        catStage.value = 'test';
        catFromWrongbook.value = true;
        catSnapshots.value = {};
        catStartTime.value = Date.now();
        catElapsed.value = '';
        resetCatAnswer();
        // 3.0：「错题重考」不再是独立入口，它是错题本里发起的一轮「按题型自测」。
        // catFromWrongbook 仍然置真（它记录的是这一轮的来源），但**不再改变离开规则**
        // ——答对一样只计连对，累计 3 次才移出（§7.4.1）。
        switchTab('practice');
        setPracticeMode('bytype');
      }

      /* ============ AI 提示词 ============ */
      async function copyAiPrompt() {
        try {
          await navigator.clipboard.writeText(aiPrompt.value);
          aiCopied.value = true;
          setTimeout(() => { aiCopied.value = false; }, 2000);
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = aiPrompt.value;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          aiCopied.value = true;
          setTimeout(() => { aiCopied.value = false; }, 2000);
        }
      }
      function downloadAiPrompt() {
        saveText('MemoDeck-AI题库转换提示词.md', aiPrompt.value);
      }

      /* ============ 初始化 ============ */
      loadStart();

      return {
        activeTab, activeTabLabel, sourceMeta, currentBank, papers, hasMultiplePapers, features, currentPaperId, bank, dataError,
        remoteUrl, pasteText, managerUrl, dataBusy, dragActive, toastMsg, toastOk,
        themeMode, applyTheme, setTheme,
        // —— 3.0 导航 / 形态 / 对话框 ——
        navItems, visibleNavItems, isMoreActive, isNarrow, isWide,
        practiceMode, practiceModes, practiceModeHint, setPracticeMode,
        showMoreSheet, wbOpen, wbToggle, dialog, closeDialog, openDialog,
        formFactor, formHint,
        appVersion: (global.MEMODECK_VERSION && global.MEMODECK_VERSION.APP) || '3.0.0',
        viewVersion: (global.MEMODECK_VERSION && global.MEMODECK_VERSION.VIEW) || '1.0.0',
        practiceQueue, practiceShowAnswer, practiceCard, practiceMastered, practiceProgress,
        passLabel, failLabel, totalQuestions, tabs,
        previewRevealed,
        catStage, catSelected, catInput, catChoice, catMultiSel, catBlanks, catRevealed, catFeedback,
        catIndex, catStats, catWrongItems, catError, catCurrent, catNextLabel, hasPrevCat, catElapsed, catTypes, catAllSelected,
        catProgressPct, catElapsedLive, catOptionState, catOptionFlag,
        catTriplet, catHistory,
        customForm,
        wrongTab, wrongCount, wrongFiltered, wrongItems, wrongSourceTabs, wrongStatusDist,
        wrongPracticeQueue, wrongPracticeShow,
        showAiModal, aiPrompt, aiCopied,
        fetchUrl, refresh, applyPaste, clearAndReload, onDragOver, onDragLeave, onDrop, onFileChange,
        downloadCurrent, copyCurrent, downloadRules, switchPaper, switchTab,
        doExportBackup, onImportBackup, doClearAll, confirmClearAll,
        resetPractice, mark, togglePreview, addPreviewToWrongbook,
        toggleCatType, selectAllTypes, startCat, catSubmit, catSelfJudge, catNext, catPrev,
        catRestart, addCustomQuestion, isObjective, isRegisteredType,
        sourceLabel,
        wrongRemove, wrongClear, startWrongPractice, wrongMark, startWrongExam,
        wrongMarkMastered, askRemoveWrong, askClearWrongbook,
        copyAiPrompt, downloadAiPrompt,
        // —— 3.0 今日页 ——
        todayLabel, todayDueCount, todayOverdueCount, todayLearnedCount, todayRemainingCount,
        todayProgressPct, todayEtaMinutes, dueBreak,
        dailyTargetN, saveDailyTarget, editDailyTarget,
        startToday, startWeakAttack,
        allResumes, resumeFrom, dismissResume,
        // —— 今日/学习状态 ——
        bankGids, dashboard, dailyTask, weekActiveDays, weekGoalDays,
        resumeStudy, resumeExercise, resumeExam,
        // —— 背诵（原「学习」）——
        studyMode, studyScope, studyCustomStart, studyCustomEnd, studyStrategy,
        studyPerSession, studyPerSessionCustom, studyTypes,
        studyShowAnswer,
        studyPassCount, studyFailCount, studyNewMastered, studyNewWrong, studyMaxStreak,
        studySwipeX, studySwipeActive,
        studyElapsedSec, studyCurrentItem, studyNextItem,
        studyTotal, studyProgressPct, studyCurrentProgress, studyPrevHint,
        studyScopeCounts, studyCustomCount, studyAvailableCount,
        studyStart, studyResume, studyMark, studyNext,
        studyExit, studyRestart, studyFormatDuration,
        studyOnSwipeStart, studyOnSwipeMove, studyOnSwipeEnd,
        studyAutoFillCustomEnd, studyTriplet,
        // —— 答题（原「练习」）——
        exerciseMode, exerciseScope, exerciseCustomStart, exerciseCustomEnd, exerciseStrategy,
        exercisePerSession, exercisePerSessionCustom, exerciseTypes,
        exerciseIndex,
        exerciseAnswerSubmitted, exerciseChoice, exerciseMultiSel, exerciseInput, exerciseBlanks,
        exerciseFeedback, exerciseSelfResult, exerciseCanSubmit, exerciseUnsupported, exerciseHistory,
        exerciseOptionState, exerciseOptionFlag,
        exercisePassCount, exerciseFailCount, exerciseSummaryIcon, exerciseNewWrong, exerciseNewMastered, exerciseElapsedSec,
        exerciseSwipeX, exerciseSwipeActive,
        exerciseCurrentItem, exerciseNextItem, exerciseTotal, exerciseProgressPct,
        exerciseCurrentProgress, exercisePrevHint, exerciseBadgeCount, exerciseWrongbookCount,
        exerciseStart, exerciseResume,
        exerciseSubmit, exerciseSelfJudge, exerciseNext, exerciseExit, exerciseRestart,
        exerciseOptionClick, exerciseIsOptionOn, exerciseAutoFillCustomEnd,
        exerciseOnSwipeStart, exerciseOnSwipeMove, exerciseOnSwipeEnd,
        exerciseTriplet,
        // —— 模拟考试 ——
        examMode, examScope, examCustomStart, examCustomEnd, examStrategy,
        examPerSession, examPerSessionCustom, examTypes,
        examQueueGids, examIndex, examElapsedSec,
        examAnswers, examSheetOpen, examPassCount, examFailCount, examWrongItems,
        examPendingItems, examBlankItems, examGradedCount, examScorePct,
        examAnsweredCount, examCurrentItem, examTotal, examProgressPct,
        examIndexLabel, examBadgeCount,
        examStart, examResume, examJump, examPrev, examNext, examSubmit, examSelfJudge, examExit, examRestart,
        askSubmitExam: examSubmit,
        examOptionClick, examIsOptionOn, examAutoFillCustomEnd,
        examInputProxy, examChoiceProxy, examMultiSel, examBlanks
      };
    }
  });

  // 3.0：共享组件与题型控件全部注册在 app 上（唯一一份实现，见各自文件头注释）
  if (UIComponents) UIComponents.install(app);
  if (Types) Types.install(app);

  app.mount('#app');
})(window);
