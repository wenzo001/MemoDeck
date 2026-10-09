# MemoDeck · 架构设计

> 面向二次开发者的实现说明。只想用这个项目？请看 [README.md](../README.md) 和 [使用说明](./USAGE.md)。

## 一、设计约束（一切的起点）

这个项目有三个硬约束，决定了全部技术选型：

| 约束 | 来源 | 带来的取舍 |
|---|---|---|
| **双击 `index.html` 即可用** | 使用者不一定有 Node / 服务器 | 不能用 ES Module（`file://` 下 CORS 会拦截），不能用构建工具 |
| **完全离线** | 内网 / 无网环境 | Vue 必须本地化，不能依赖 CDN |
| **题库由 JSON 驱动** | 题目来自不同考试科目 | 应用不能写死题型，必须注册表化 + 归一化 |

结论：**无构建步骤的纯静态应用**，用普通 `<script>` 标签 + `window` 全局命名空间组织模块。这不是偷懒，是 `file://` 兼容性的唯一可行解。

## 二、模块划分

```
window
├── EXAM_CONFIG    config.js       运行配置（远程题库地址 / JSON 管理服务入口 / 三组版本号）
├── DEFAULT_BANK   default-bank.js 内置兜底题库（window 全局，供离线首启）
├── Vue            vendor/         Vue 3.5.13 全局构建（生产版）
├── ExamCore       js/core.js      纯逻辑：格式识别、归一化、条目构建
├── ExamStore      js/store.js     localStorage 读写
├── ExamLeitner    js/leitner.js   Leitner 间隔重复算法（会话内队列）
├── ExamWrongbook  js/wrongbook.js 错题本数据操作（v2：状态机 + gid 判重）
├── ExamUtils      js/utils.js     轻量工具集（shuffle / groupBy，对齐 lodash 语义）
├── ExamQueue      js/queue.js     纯逻辑：取题管线（范围 → 题型 → 排序 → 截断）
├── ExamMigration  js/migration.js v1 → v2 一次性迁移
├── ExamProgress   js/progress.js  跨会话学习进度与复习调度（SRS）
├── ExamSession    js/session.js   恢复点、分段、每日任务生成
├── ExamStats      js/stats.js     首页与趋势的统计聚合（纯函数）
├── ExamBackup     js/backup.js    全量导出 / 合并或覆盖导入 / 清空 / 旧备份归一
├── ExamAIPrompt   js/ai-prompt.js AI 转换提示词文本
├── ExamNav        js/navigation.js 3.0：导航模型 + 旧地址兼容表 + 旧开关键名映射（纯函数）
├── ExamJudge      js/judge.js     3.0：判分口径唯一实现（从 app.js 的闭包里搬出来）
├── ExamTypes      js/types.js     3.0：题型注册表 + 六种作答控件 + 未注册题型只读兜底
├── ExamComponents js/components.js 3.0：跨页共享组件（判分横幅 / 参考答案 / 芯片 / 三联格 / 口径条）
└── （Vue app）    js/app.js       Vue 应用：状态机与交互（判分、导航映射已外移）
```

**加载顺序**（`index.html` 底部，顺序不可调换）：

```
default-bank.js → vendor/vue.global.prod.js → config.js
→ core.js → store.js → leitner.js → wrongbook.js
→ migration.js → progress.js → utils.js → queue.js → ai-prompt.js
→ session.js → stats.js → backup.js
→ navigation.js → judge.js → types.js → components.js → app.js
```

依赖约束：`queue.js` 用 `utils.js` 的 shuffle；`session.js` 用 `progress.js` 的
`getDueQuestions`，必须排在其后；`core.js` 的 `normalizeBlanks` 在**运行时**读
`ExamTypes.splitBlankAnswers`（读不到时有内置兜底实现），所以 `types.js` 只要排在
`app.js` 之前即可，不必排在 `core.js` 之前。

分层原则：`core / store / leitner / wrongbook / utils / queue / migration / progress /
session / stats / navigation / judge / types / components` **不依赖 DOM 和 Vue**，
可以单独在 Node 里跑单元测试；只有 `js/app.js` 碰 Vue 实例与页面状态。
`app.js` 里凡是能脱离响应式系统成立的逻辑都往外挪——判分（`ExamJudge.judge`）、
取题（`ExamQueue`）、统计（`ExamStats`）、导航与地址映射（`ExamNav`）
都有唯一实现处且可单测。

> **3.0 为什么把 `judgeObjective` 挪出 app.js**：DESIGN.md §4.3 写明判分是
> 「全局唯一口径，不得产生第二套实现」。它原先住在 Vue setup 的闭包里，
> 唯一实现是真的，但**只能靠手点界面验**——单测碰不到，等于最该钉死的一段没有防线。
> 挪到 `js/judge.js` 后 `test/v3-compat.test.js` 直接打它，并且加了一条反向门禁：
> 判分公式的两处签名若出现在 `judge.js` 以外的任何 js 文件里，测试就红。
> 已做变异验证：把多选判分抄进 `stats.js` → 被抓到并指名文件。

> **为什么不引 lodash**：本项目为零第三方运行时依赖（`file://` 离线 + 纯逻辑零依赖单测）。lodash 全量约 530KB，而实际只有洗牌/分组两类需求。于是自建约 2KB 的 `utils.js`，函数语义对齐 lodash 同名函数；将来确有大需求时可平滑换成 `vendor/lodash.min.js`。

## 三、数据流

```
                    ┌──────────────────┐
   内置题库 ────────▶│                  │
   data.json ───────▶│  normalizeBank() │──▶ { meta, features, papers }
   远程 URL ────────▶│   （core.js）     │            │
   粘贴文本 ────────▶│                  │            ▼
   拖拽/选择文件 ───▶└──────────────────┘      buildItems(bank, paperId)
                                                     │
                                                     ▼
                                              条目数组 items[]
                                                     │
   3.0 入口（js/navigation.js 决定「哪个入口跑哪台状态机」）
                        |
     今日 --+-- 练习（六模式分段）--+-- 错题本 --+-- 题库
            |        |              |           |
            |   背诵 recite   ---- session mode: study
            |   答题 answer   ----          : exercise
            |   按题型自测 bytype ----      : category
            |   模拟考试 mock   ----        : exam
            |   浏览速览 browse ----        : preview
            |   闯关队列 queue  ----        : practice
            v
        取题统一走 ExamQueue -> 判分统一走 ExamJudge -> 进度统一写 ExamProgress
            |
            +- 答对：Wrongbook.creditCorrectByGid（3.0 单一离开规则）
            +- 答错：Wrongbook.add（gid 全局去重，重复入本状态打回 new）
```

> **3.0 只重组了入口，没有动管线。** ExamQueue 的取题口径、ExamJudge 的判分口径、
> ExamProgress 的状态机与 session mode 键名全部与 2.x 一致（DESIGN.md §9 第三步的硬要求：
> 「迁移时保持原有取题管线与判分实现不变」）。上面那张「入口 -> 模式 -> session mode」的映射
> 是本次重构唯一新增的间接层，它整个住在 js/navigation.js 里、可单测 —— 旧书签、旧恢复点、
> 旧题库开关的兼容性全靠它，它一旦错就是这三类数据同时失效。


### 3.1 条目（item）结构

`buildItems()` 产出的条目是七个模式共用的渲染单元：

```js
{ id, rawType, typeLabel, group,           // 身份与分组
  question, q,                             // 原始题干 / 渲染题干（选择题已拼上选项）
  a, answer,                               // 渲染后的答案 / 标准答案原值
  blanks, options, explanation, paper,     // 题型专属字段与出处
  paperId, gid }                           // v2：跨卷唯一标识
```

`gid = makeGlobalId(paperId, id)`，形如 `卷1::42`。**它是学习进度、恢复点、错题本判重
共用的主键**，跨卷、跨导入、跨会话稳定；不同卷里 id 相同的题 gid 不同。

### 3.2 两套"掌握"模型并存（重要）

| | 会话内 | 跨会话 |
|---|---|---|
| 模块 | `leitner.js`（闯关队列、错题加强练习） | `progress.js`（背诵 / 答题 / 按题型自测 / 模拟考试） |
| 掌握条件 | 记住一次即出队 | 连续答对 5 次 → `mastered` |
| 答错处置 | 埋到 5~7 张之后重现 | `streak` 归零，下次立即复习 |

两者互不干涉：闯关只管「这轮还出不出现」，progress 只管「什么时候该复习」。

**3.0 把这条界线写进了界面词汇**（DESIGN.md §7.3）。代码里有两个不同概念都叫 `weak`，
用户读到同一个词就会把两个数读成一个：

| 归属 | 数据层取值 | 3.0 界面名 | 规则 |
|---|---|---|---|
| 跨会话记忆进度 | `new` / `learning` / `review` / `mastered` | 新题 / 学习中 / **需复习** / 已掌握 | 「需复习」= review 档 |
| 错题本 | `new` / `learning` / `weak` / `mastered` | 新错 / 巩固中 / **模糊** / 已攻克 | 连对 2 次=模糊，连对 3 次移出=已攻克 |
| 会话内队列 | —（不落盘） | **本轮攻克** | 原「一次即掌握」改名，明确不产生跨会话含义 |

词表唯一出口是 `js/components.js` 的 `status-chip`（`set` 参数决定读哪张表），
界面任何地方都不再手写这些词。
**「当次答对」与「跨会话已掌握」是两个数、两个名字、不可相加** —— 这条口径必须出现在界面上。

判分行为本身另见 [EXAM_JSON_SPEC.md §3.2](./EXAM_JSON_SPEC.md)，
唯一实现是 `js/judge.js`。

**数据源优先级**：localStorage 缓存 > `data.json`（仅 http/https）> 内置兜底题库。

`file://` 下浏览器禁止 `fetch` 本地文件，所以 `data.json` 自动加载只在 http/https 生效——这不影响使用，缓存和手动导入两条路依然畅通。

## 四、核心模块详解

### 4.1 `core.js` —— 归一化是全局基石

所有入口（导入 / 缓存 / 内置）的 JSON 都要先过 `normalizeBank()`，它把三种形态统一成 `{ meta, features, papers }`：

| 输入形态 | 识别条件 | 说明 |
|---|---|---|
| **标准格式** | `view === 'exam-bank'` 且 `papers` 是数组 | 推荐，见 [EXAM_JSON_SPEC.md](./EXAM_JSON_SPEC.md) |
| **顶层数组** | 根节点是数组 | 数组元素按 paper 解析 |
| **旧版格式** | 存在含 `questions` 的顶层键 | 卷子键 + 分题型对象，自动映射中文题型名 |

归一化后再由 `buildItems()` 生成渲染条目，四个 Tab 复用同一份条目结构。

**题型注册表** `TYPE_REGISTRY` 是唯一的题型声明处：

```js
const TYPE_REGISTRY = {
  fill_blank:         { label: '填空题', order: 1 },
  true_false:         { label: '判断题', order: 2 },
  single_choice:      { label: '单选题', order: 3 },
  multi_choice:       { label: '多选题', order: 4 },
  essay:              { label: '问答题', order: 5 },
  special_fill_blank: { label: '专项题', order: 6 }
};
```

新增题型要动四处（`TYPE_REGISTRY` 只是入口，不是唯一改动点）：

1. `core.js` 的 `TYPE_REGISTRY` 加 `{ label, order }`；
2. `core.js` 的 `normalizeQuestion()` / `renderAnswer()` 补分支（决定是否带 `blanks` / `options`）；
3. `app.js` 的 `isObjective()` 与 `judgeObjective()` —— 决定它是系统判分还是用户自评；
4. `index.html` 里各模式的作答区模板，以及 setup 面板的题型勾选框（目前 6 个 key 写死在
   `studyTypes` / `exerciseTypes` / `examTypes` 与对应 `<label class="type-check">`）。

未知题型不会崩，会兜底显示题干和 `answer`；判分上按主观题走（不自判、等自评）。

### 4.2 `leitner.js` —— 记忆调度

```
MIN_FAIL_GAP = 5   // 答错后至少埋到 5 张之后（+0~2 随机），保证隔四五道题才重现
```

- `markPass(card)` → 判定掌握，恒返回 `{ mastered: true, card }`，卡片移出队列（进度前移）。
- `markFail(card)` → `streak = 0`，埋到 `5 + rand(0..2)` 张之后；当前卡被跳过，队首换成下一张。

队列是纯数据（卡片数组 + 每张卡的 `streak`），不碰 DOM，因此可单测。

### 4.3 `store.js` / `wrongbook.js` —— 持久化

| Key | 内容 | 读写方 |
|---|---|---|
| `examBankCache:v2` | `{ source, url, data, fetchedAt }` 题库缓存信封 | store.js |
| `examWrongbook:v1` | `{ entries: [...] }` **运行时错题本真相源** | wrongbook.js |
| `examWrongbook:v2` | 迁移导出格式（v1 条目的 v2 视图） | migration.js |
| `examProgress:v1` | `{ version, progress: { [gid]: ProgressEntry } }` | progress.js |
| `examSession:v1` | 恢复点（内部 version 2：按 mode 分桶 `resumes: { study, exercise, exam }`，考试桶含逐题答案快照 `answers`） | session.js |
| `examSettings:v1` | 每日学习量等设置 | session.js |
| `examLeitnerQueue:v1` | 闯关队列持久化 | leitner.js |
| `memo:theme` | 主题偏好 `'auto'│'light'│'dark'`（3.0 起 `applyTheme` 还会把解析结果写进 `data-theme` 属性） | app.js |
| `memo:practiceMode` | 3.0：练习页上次用的模式（`recite`/`answer`/`bytype`/`mock`/`browse`/`queue`） | app.js |

> 备份（`js/backup.js`）导出的是**以上全部 `exam*` 键**，新增存储键时必须同步进去。
>
> `examWrongbook:v2` 只由迁移写入、供导出使用；运行时一律以 `:v1` 为准。首页统计读的也是
> `:v1`（经 `Wrongbook.list()`），历史上这里错读过 v2 快照导致角标与首页对不上。

错题条目带 `source` 字段，取值即「在哪个模式答错的」，共五种：
`study`（背诵）/ `exercise`（答题）/ `practice`（闯关队列）/ `preview`（浏览速览）/
`exam`（模拟考试与按题型自测）。**3.0 收敛了入口，但这五个值一个都没改** ——
它们既存在错题条目里、又是恢复点的分桶键，改名等于丢数据。
错题本按来源筛选，**列表由 `WRONG_SOURCES` 注册表派生**，只渲染真实有题的来源——
新增模式时改这张表即可，不要再往模板里硬写按钮。

**全局去重**：`wrongbook.add()` **优先按 `gid` 判重**（不看来源），同一道题只保留一条；
无 gid 的老数据回退到「题目 id + rawType」。重复入库时刷新来源为最新出错场景、
`wrongCount++`、`correctStreak` 归零、状态退回 `new`。

**入库时机**：闯关「没记住」、背诵「还不会」、答题/自测/考试答错、模拟考试交卷判错，
都由 `app.js` 实时写入并刷新视图（不等流程跑完）。**未作答不计入错题本**。

**移出时机（3.0 收敛为一条规则）**：任何入口答对都计连对，累计连对 3 次自动移出，
移出时**必须**告知原因。状态机：1 次 `new`/`learning` → 2 次 `weak`（界面叫「模糊」）
→ 3 次 `mastered` 并移出（界面叫「已攻克」）。

- 唯一落点是 `Wrongbook.creditCorrectByGid(gid)`，六个模式的答对路径全部走它；
  不在错题本里的题它是 no-op，绝不因答对一道没错过的题而造记录。
- 2.x 的三条并行规则已删两条：「其它入口答对不计次」改为计次；
  **「错题重考答对 1 次即 `removeByItem` 立刻移出」的短路整条删除**
  （它让重考成了一条比日常复习更宽松的出本通道）。
  `catFromWrongbook` 这个标记还在，但只用于记录来源，不再改变离开规则。
- 移出与手动删除都写 `history`（`{ gid, itemId, at, reason }`），
  错题本的「已攻克」计数与移出原因文案都从它来。老数据没有该字段时按空数组读。

### 4.4 `queue.js` —— 取题管线

学习 / 练习 / 模拟考试三个模式原本各有一份逐字重复的「范围过滤 → 题型过滤 → 排序 → 截断」，
现已收敛为 `ExamQueue`，纯函数、依赖全部由调用方经 `ctx` 注入（进度表、错题集合、到期集合、
每日任务调度），因此能在 Node 里被 `test/queue.test.js` 覆盖 21 项。

它同时钉死了这条不变式：**`queueCountOf()` 必须等于 `buildQueueGids().length`**。
界面上的「将学习 N 题」和实际排队数曾长期不一致（显示不应用每次数量的截断）。

### 4.5 `app.js` —— Vue 应用

使用 Vue 3 组合式 API + `setup()`，**模板留在 `index.html` 里**（in-DOM template），逻辑全在 `app.js`。这样改界面不用碰 JS，改逻辑不用碰 HTML。

`app.js` 内部的约定：凡是脱离响应式系统也能成立的逻辑，一律往外挪到上面那些纯模块。
留在 `app.js` 里的只有三类——ref 状态、computed、事件处理器。共享机制同样要抽干净：
判分 `judgeObjective`（四个模式一份）、会话计时器 `makeSessionTimer`（三个模式一份）、
滑动手势 `makeSwipe`（学习/练习一份）。

**Tab 与 URL**：`activeTab` 与 `location.hash` 双向同步（`#/study` 等）。
`manifest.json` 的桌面快捷方式依赖它，同时刷新页面不再退回首页。

## 五、模板书写约定（重要）

> **模板属性值内一律不要写 `>` 或 `=>`。**

原因是本项目在开发过程中被 HTML 处理工具（Ardot 设计工具）自动注入过 `data-page-node-id` 属性，该工具的注入逻辑有缺陷，会把属性插入到属性值内部的 `>` 和 `=>` 中间，例如：

```html
<!-- 期望 -->
<div v-if="papers.length > 1">
<!-- 被破坏成 -->
<div v-if="papers.length data-page-node-id="xxx" > 1">
```

Vue 编译直接报错，页面白屏，且生产版 Vue 会吞掉错误信息，极难排查。

**正确做法**：把含 `>` / `=>` 的表达式抽成 computed 或 method。

```js
// ✅ 安全
const hasMultiplePapers = computed(() => currentBank.value.papers.length > 1);
const wrongItems        = computed(() => wrongEntries.value.map(e => e.item));
```

```html
<div v-if="hasMultiplePapers">…</div>
<button @click="startWrongPractice(wrongItems)">…</button>
```

现存的安全替身：`hasMultiplePapers`、`wrongItems`、`catNextLabel`。

## 六、样式约定

3.0 起仍为**六件套**（`index.html` 按此顺序引用）：

| 文件 | 职责 |
|---|---|
| `tokens.css` | **唯一**的浅色 token 声明处 + `--md-*` 语义层 + 2.x 短名兼容别名 + 全局布局防护 |
| `components.css` | §4.1 组件族（主/次按钮、选项块、状态芯片、判分横幅、三联格、口径条、恢复卡、错题条目、分段控件、底部导航、侧栏、**作答控件**）+ §4.5 图标规则 |
| `pages.css` | 四个一级页面的布局（`md-today-` / `md-study-` / `md-wrongbook` / `md-bank-` 前缀隔离）与 768+ 双栏 |
| `responsive.css` | **七档断点表**（320/360/430/560/768/1024/1440）→ 只负责给 `--md-*` 布局 token 取值 |
| `themes.css` | 3.0 起几乎为空：只有主题切换控件与三处读不到 token 的硬编码 |
| `accessibility.css` | `prefers-reduced-motion` 降级 + 全局 `:focus-visible` 描边 |

> v1 的单文件 `css/style.css` 已在 2.1.0 删除（长期不再被 `index.html` 引用）。

### 6.1 3.0 的 token 架构（这一条改错了会全站漂移）

- **浅色值只有 `tokens.css` 的 `:root` 一处；深色值只有 `html[data-theme="dark"]` 一处。**
  2.x 有三份深色声明（`tokens.css` 的 `@media`、`themes.css` 的手动 dark、
  `themes.css` 的 `@media :root`），同一个 HEX 写三遍，改一处漏两处。
  3.0 的解法是让 `applyTheme()` **永远**把解析后的 `'light' | 'auto'→实际值'` 写进
  `data-theme`（`js/app.js`），于是 token 层不再需要 `@media (prefers-color-scheme)`，
  系统偏好与手动覆盖走同一条路径 —— 「系统 dark + 手动 light 漏深色」这一类 bug 从根上消失。
  代价是首屏会闪一下：所以 `index.html` 的 `<head>` 里有一段内联脚本先落 `data-theme`。
- **组件只准用语义 token（`--md-*`），不准写字面色。** 2.x 的短名
  （`--primary` / `--surface` / `--text-main` …）保留为**兼容别名层**，一律 `var()` 指向
  `--md-*`，不重复声明 HEX。新增组件请直接用 `--md-*`。
- **`--primary` 在 3.0 指琥珀（唯一强调色），主操作是 `--md-ink`。**
  两者必须分开：琥珀/绿/红/蓝四个语义档已被「到期、判对、判错、待自评」占满，
  主按钮若也用琥珀就会和「今日到期」撞车（DESIGN.md §1.3 的关键取舍）。
  看到 `--primary` 别以为是"主按钮色"。
- **历史短名的语义被改过一处**：`--warn` 从橙色改成蓝色档
  （§7.3 要求「需复习」走蓝，不给界面加第 5 个色相）。依赖它字面含义的规则都已改读 `--md-*`。

约定不变：

- **移动优先 + 断点从宽到窄书写**：媒体查询没有特异度，同一个属性写两遍时**后出现的赢**。
  所以 `--md-page-pad` 的 20→18→16 三档必须按 `max-width: 559 / 429 / 359` 的顺序排，
  窄屏写在后面。2.x 有过一条 `@media (max-width:559px){--md-page-pad:20px}` 排在
  `max-width:359px` 之后、把 16px 顶掉的自伤写法。
- **触摸目标 ≥ 44×44pt（iOS HIG），相邻目标间距 ≥ 8px —— 这一条不分宽度全局生效。**
  2.x 把 44px 补偿写在 `responsive.css` 的窄屏块里，宽屏上是空的：实测主题切换按钮
  在桌面上仍是 28×28，等于门禁在最不该省的地方失守。3.0 起 `.btn` / `.icon-btn` /
  `.theme-btn` / `button.md-chip` / `.per-chip` / `.md-study-radio` / 输入控件都直接按 44 设。
  两个例外按设计稿保留：答题卡题号在桌面侧栏 5 列约 32px（指针操作可接受）、
  状态芯片**视觉**高 22（但可点的芯片 `button.md-chip` 命中区仍抬到 44）。
- **可见焦点态**：统一 `:focus-visible` 描边（`accessibility.css` 全局给），键盘可达一切交互元素
- **尊重 `prefers-reduced-motion`，但不是"全部关掉"**：DESIGN.md §8 的降级口径是
  「取消位移与脉冲，保留 ≤100ms 透明度变化，进度条直接跳变」。
  2.x 写的 `* { transition:none !important; animation:none !important }` 连淡入都杀，界面变硬切。
  ⚠️ 另外「答对自动前进」的 0.6 秒是 JS 定时器、是节奏控制不是装饰动效，
  降级时**不能**把它一起关掉。
- **背景不用纯白/纯灰，也不用渐变**：3.0 反过来——DESIGN.md §7.1 把「渐变背景、玻璃拟态」
  列为禁止项（与"可信、专业"冲突，且离线性能差）。2.x 的
  `.md-home-today` 渐变卡、`.md-study-progress-bar` 的 primary→success 渐变已删，改琥珀实色。
  唯一保留的半透明是吸顶应用栏的 `--chrome-bg` + `backdrop-filter`。
- **卡片只用于真正独立的重复对象，不套卡片**（§5.4）；层级靠 间距 < 相关项 < 分组 < 区块 表达
- **固定底栏必须配底部留白**：`.md-study-stage` / `.md-exam-main` 都留了
  `padding-bottom`，否则最后一个选项会被 `position: fixed` 的操作栏压住
- **跨页面复用的组件不带页面前缀**：作答控件 `.md-opt-list` / `.md-opt` / `.md-opt-key` /
  `.md-tf` / `.md-tf-btn` 与判分横幅 `.md-judge-banner` 定义在 `components.css`，
  答题、按题型自测、模拟考试共用同一套类名与状态语义
  （`selected` → `missed`/`correct`/`wrong`，按此顺序声明以便后者压过前者）。
  **判断/单选/多选必须共用同一个 `judge-result` 组件**（§4.3），差异只允许在判分函数。
  只有单页面专属的样式才用 `md-<页面>-` 前缀
- **形状即语义，不可为视觉统一互换**（§4.2）：单选圆点、多选方框、填空带序号输入框、
  判断两个大按钮。`.md-opt.is-radio` / `.is-check` 由 `js/types.js` 的题型注册表给，
  界面层不再按题型手写 `v-if` 选形状
- **图标按 §4.5 五条走**：容器给底色与圆角、图标只有字形；一律 flex 居中，禁止用
  `padding`/绝对定位去"挪"；一个图标 = 一个内联 SVG，不许把底色和字形拆成两个并列元素；
  描边型图标的圆底由容器给。自检：给容器临时加 `.icon-debug`（`components.css` 里，
  高对比底色）看字形是否偏离几何中心，22 / 24 / 30 / 44 四档各跑一次
- **长列表窗口化只有一份实现**（`js/virtual.js` 出算术、`js/components.js` 出 `<window-list>`）：
  浏览速览与错题本共用；行数 ≤ `threshold`（60）时整份渲染、不进窗口逻辑（短列表更快，
  也少一层边界情况）。滚动容器是**页面**而不是列表自己 —— iOS 惯性、地址栏收放、
  底栏让位那套 token 都不受影响。三条实测出来的硬规矩：
  1. **外框高度恒定 + 内块 `transform: translate3d` 位移，不要用上下占位条撑高度**：
     改占位条高度会让整篇（30 万像素）文档重新布局，实测滚动 p95 从 28ms 涨到 33/61ms；
     transform 只走合成。
  2. **滚动回调里只在窗口真的需要移动时才写数据**：每帧都写 → Vue 每帧重渲染十几行 +
     强制布局，实测 p95 打到 80ms。窗口移动量与 `step`（默认 6 行）绑定后，慢速滚动不产生 DOM 工作。
  3. **行包装必须 `flow-root` + `contain: layout paint`**：行内容（`.exam-item` / `.wb-item`）
     带 `margin-bottom`，外边距会折叠到父盒之外 → 量到的高度不含外边距 → 每行少 10–14px，
     几百行后位置整体错位；`contain` 把重排范围关在进出那几行里。
  另外：行数必须显式传给 `buildOffsets(count, heights, rowHeight)` —— `heights` 是稀疏数组
  （只记已实测的行），拿 `heights.length` 当行数会让首次渲染推出 n=0、整个列表渲染成空。
  验滚动类改动时**别用绝对毫秒**：这台机器同一份代码能从 28 漂到 190ms；
  在同一次运行里交替加载「窗口化 / 全挂载」两份取**比值**，漂移才会抵消。
- **`.icon` 自带 `margin-right: .375em`，居中的方形容器必须把它关回 0**：这道边距是给
  「图标 + 文字」的行排间距用的，但 `justify-content: center` 抵不过单边外边距 ——
  22×22 的 `.md-opt-key` 实测被推走 4.125px，字形中心偏 2.07px，就是 §4.5 说的「图标不居中」。
  关边距靠的是 `components.css` 里那条 `[icon-box]` 选择器名单，**名单一定会烂**：
  这次同时发现漏了 `.md-opt-key` / `.md-resume-close`，还留着 2.x 已不存在的
  `.tab-nav` / `.resume-icon` / `.md-home-quick-btn` 三个死选择器。
  新增 flex 居中 + 正方形的图标容器时必须同步加进那条名单，`test/icons.test.js` 会
  双向核对（容器没进名单 → 红；名单里有死类名 → 红）。
  **为什么用静态测试而不是像素门禁**：浏览器侧的几何门禁要真视口、要构造出「选中态」
  「判分态」「有恢复点」才量得到四档，进不了 CI；静态这条不需要浏览器，能在 CI 里守住同一件事
- **对比度按 WCAG AA 正文 4.5:1 校验**：站内这些文字都是 11–16px 加粗，按 WCAG 定义不算
  「大文本」（要 ≥18.66px 粗体），所以适用 4.5 这一档，不是 3.0。DESIGN.md §2.3 的比值是
  手算结果，**未在真实渲染像素上复核**，改色时不要把它当实测值引用
- **题干与选项正文在任何断点都不截断、不缩字**（§8 铁律）。容器挤压时先隐藏次要元信息
  （`.md-hide-narrow` / `.md-home-est` / `.md-study-timer`）、再降内边距、最后才动分栏。
  唯一允许截断的是错题条目的题干预览（2 行 + 「展开全文」按钮），因为它有明确的展开出口
- **`responsive.css` 不是最后一份 CSS，覆盖主题层规则要抬一档特异度**：加载顺序是
  tokens → components → pages → responsive → **themes** → accessibility。断点里写
  `.theme-btn { … }` 会被 `themes.css` 的同特异度规则后来吃掉。
  3.0 顺手把这个坑填了：`.theme-btn` 的尺寸只在 `themes.css` 一处声明（含 44px），
  不再需要在断点里覆盖它。但**规则本身仍然成立** —— 新增跨文件覆盖时先数加载顺序。
- **共享组件的移动端紧凑档写在 `responsive.css`**：`.md-opt` 46px / `.md-opt-key` 22px /
  `.md-tf-btn` 14px 集中在那里，跟组件定义分处两地但按「断点改尺寸」这一条规则可寻。
  页面级断点目前仍有 3 处留在 `pages.css`（首页 / 学习 / 考试），实测没有被后面的基础规则
  同特异度顶掉，属可选整理
- **断点里翻转 `flex-direction` 时，必须同时复核 `align-items`**：行方向的
  `align-items: flex-start`（本意是「两列顶部对齐」）到了列方向就变成「不拉伸交叉轴」，
  卡片会缩到内容宽度并左贴边 —— 模拟考试移动端就这么错位过（实测卡片 309.6px / 容器 358px）。
  同理 `flex: 1` 等于 `flex-basis: 0`，翻成列方向后压的是高度，要写成 `flex: 1 1 auto`
- **`position: fixed` 的底栏必须加安全区**：`bottom: calc(12px + env(safe-area-inset-bottom, 0px))`。
  `body` 上的 `padding-bottom: env(...)` 对 fixed 元素无效；`display: standalone` 的 PWA
  在刘海机上不加就会被 home indicator 压住。同理，浮层的 `bottom` 要按**被遮挡物的实际高度**算
  （答题卡原来写 `bottom: 60px`，而操作栏顶边在 78px，最后一行题号被盖）
- **靠 `opacity` + `transform` 隐藏的浮层必须同时置 `visibility: hidden`**，
  否则它会以透明状态继续拦截点击并留在键盘 Tab 序列里（移动端答题卡踩过这个坑）
- **全局兜底规则必须保持零特异度**：防 flex 溢出的 `min-width: 0` 早先写成 `#app *`
  （特异度 `1,0,0`，比任何组件规则都高），把全站 6 处 `min-width` 静默吃掉，徽标被压成
  竖椭圆。兜底类规则一律用 `* > *`（特异度 0），让组件的声明永远能盖过它。
  同一条也适用于元素级基础档：`input[type="text"] / textarea / select` 的默认样式现在包在
  `:where(...)` 里（特异度归 0），否则 `(0,1,1)` 会反过来吃掉 `.md-field` 这类 `(0,1,0)`
  组件的边框与禁用态 —— 同一个坑的第二个变体
- **裁横向溢出只能用 `overflow-x: clip`，不能用 `hidden`**：`hidden` 会把该元素变成滚动容器。
   写在 `html/body` 上 → document 不再滚动、滚动条跑到 body 上，`window.scrollTo()` 失效；
   写在 `#app` 上 → 它成为「内容比自身高、自己滚不动」的滚动容器，所有 `position: sticky`
   后代都拿它的 scrollport 当参照而永不吸附（旧 `.tab-nav` 的 sticky 就这样白写了几个版本）。
   `clip` 只裁不滚，viewport 仍是滚动主体；`hidden` 保留在前一行作为 Safari < 16 的退路。
   新增吸顶元素前先确认这条：`getComputedStyle(祖先).overflowX !== 'hidden'`
- **浮层只剩两个：「更多」抽屉与通用对话框**。3.0 把「数据管理」从浮层 Sheet 升级成了
  「题库」一级页面，剩下的浮层是 320–359 的 `.sheet-scrim` + `.panel.sheet`（更多抽屉，
  ≤559px 底部滑出、≥560px 居中对话框）与 `.modal-mask` + `.modal-box`
  （通用确认对话框、AI 提示词）。背板一律 `v-show`（关闭即 `display:none`），不用 `opacity` 隐藏。
  新增模态时**必须**在两处登记：`overlayIsOpen()`（让背景页快捷键让路，否则浮层开着时按 Enter
  会翻走背后的学习卡、考试里按 Esc 会直接交卷）与 `overlayKeyDown()` 的 `Esc` 关闭栈序
  （对话框 → AI 模态 → 更多抽屉）。不可逆操作（交卷、清空错题本、手动删除错题、清空全部数据）
  走通用 `openDialog()`，正文点名对象与后果（§4.1），不再用 `window.confirm`
- **`responsive.css` 不是最后一份 CSS，覆盖主题层规则要抬一档特异度**：加载顺序是
  tokens → components → pages → responsive → **themes** → accessibility。往
  `responsive.css` 里加覆盖前，先确认被覆盖的那条规则在不在 `themes.css` 里。
  （2.x 的真实案例：断点里写 `.theme-btn { width: 44px }` 被 `themes.css` 的
  `.theme-btn { width: 28px }` 同特异度后来者吃掉，实测移动端仍是 28×28。
  3.0 把这个坑填法是**取消重复声明**而不是抬特异度 —— `.theme-btn` 的尺寸只在
  `themes.css` 一处给，且直接就是 44px，不再需要断点覆盖。）
- **界面外壳只有 `.appchrome` 一块**：吸顶的 `.appchrome`（毛玻璃 + `--chrome-bg`）里装
  `.appbar`（标题 = 当前入口名 `activeTabLabel`，不是应用名；右侧只放 `.icon-btn` 图标按钮）
  和 `.tab-nav`。导航栏不放宣传语、不放带文字的灰胶囊 —— iOS 的 nav bar 只回答「你在哪个屏」。
  `.tab-nav` 自己不再 sticky（嵌套 sticky 无意义，吸附交给外壳）；
  ⚠️ 不要把 `position: fixed` 的元素挪进 `.appchrome`，`backdrop-filter` 会给它们建立包含块
- **全站不用 emoji 图标**（2.2.0 起外壳 emoji 归零，3.0 连默认文案 emoji 也清了）：
  矢量符号集中在 `index.html` 顶部的 `<svg class="icon-defs">` 符号表
  （46 个 24×24、`stroke: currentColor`），用 `<use href="#i-xxx">` 引用。
  一级导航图标按 `#i-<navKey>` 自动取（`today` / `practice` / `wrongbook` / `bank` / `more`），
  练习模式图标按 `PRACTICE_MODES[].icon` 指定，所以**新增入口只要补一个同名 `<symbol>`**。
  题库 `features[].icon` 自 3.0 起**不再被消费**（键仍解析，只为不让老 JSON 变不合法）。
  §4.5 的三条构建规则：容器负责底色与圆角、图标只负责字形并一律 flex 居中
  （禁止用 padding 或绝对定位去"挪"）；一个图标 = 一个内联 SVG，不许把底色和字形
  拆成两个并列元素；描边型图标的圆底由容器给。
  自检：给容器临时加 `.icon-debug`（高对比底色）看字形是否偏心，22/24/30/44 四档各跑一次。
  两条配套约定：① `.icon { margin-right: .375em }` 默认给「图标 + 文字」留缝，
  flex-gap 容器和纯图标容器要在后面那条重置列表里清掉，否则间距翻倍或图标偏心；
  ② 判定/状态类图标用 `:href="cond ? '#i-a' : '#i-b'"` 绑定，**带 `>` 或 `<` 的比较必须
  抽成 computed**（模板属性值里出现 `>` 会被 HTML 解析和 CI 守卫双重拒绝）
- **一个屏只有一个标题**：入口名只写在吸顶应用栏（`activeTabLabel`），页面内**不再**重复
  `<h2>开始学习</h2>` / `<h3>错题本</h3>`。状态标题（`练习完成`、`考试结束`）不算重复，保留
- **界面外壳只有 `.appchrome` 一块**
- **原生观感基线集中在 `tokens.css` 的「原生观感基线」一节，且必须保持零特异度**：界面外壳
  （按钮 / Tab / 标签 / 标题 / `label` / `summary`）默认 `-webkit-user-select: none` +
  `-webkit-touch-callout: none`，表单控件与题干文本用第二条 `:where(...)` 重新放行 ——
  判据是「这是控件还是内容」，不是元素类型。滚动条统一改成不占布局宽度的细条，
  `overscroll-behavior-y: none` 关掉橡皮筋。新增页面若出现需要选中的正文，把类名加进
  放行列表，不要在页面里另写一份 `user-select`
- **改 `position` 时必须把不需要的轴清回 `auto`**：从 `sticky`（带 `top`）改成 `fixed`（带
  `bottom`）时，旧的 `top` 会留着，而 fixed 元素同时有 `top`/`bottom` 和确定高度时 **`top` 赢**
  —— 移动端答题卡因此一直贴在屏幕上方而不是从底部滑出。覆盖定位就写全 `top/left/right/bottom`
  四个轴，或显式 `top: auto`
- **留白只允许一个所有者**：屏幕边距归 `#app` 的 `--layout-gutter`，卡片内边距归卡片。
  断点里不要再给 `body` 叠第二层 padding（实测叠过，单侧 28px、正文离边 48px，
  而且顺手抹掉了 `body` 的 `env(safe-area-inset-bottom)`）。iOS 分组列表的标准是
  屏幕 16pt + 卡片内 16pt
- **模板里的空值解引用没有任何防线**：`test/` 五个套件都只测纯逻辑与静态文本（判分/取题/
  扩展/导航兼容/图标名单），
  `v-if` 条件与子节点读取的状态不一致时不会有任何报错，只会在运行时抛错并让 Vue
  卸载整棵树（页面全白）。写 `v-if="A"` 的块里读 `B.x` 之前，先确认 `A` 为真时 `B` 必不为空
- **横向滚动容器不能用 `justify-content: center`**：内容超宽时居中会把溢出量均分到两侧，
  而浏览器只提供正向滚动条 —— 左边那段永远滚不回去（实测移动端第一个 Tab 落在
  `left: -184.6px`，`scrollLeft` 已为 0）。`overflow-x: auto` 的 flex 容器一律显式
  回到 `flex-start`，首尾留白交给 `padding` / `scroll-padding-inline`
- **删 CSS 规则只能整块删，不能只删选择器列表里的一行**：`.a, .b { … }` 中只删掉 `.b` 那行
  会留下悬空的逗号，下一条规则的头部被并进选择器列表 —— 声明看似删掉了，其实悄悄套到了
  相邻的组件上（`.md-exercise-card-head .tag` 删除后，`.tag { position: static }` 被并给了
  `.question`，题号标签退回绝对定位并与题干重叠）。删前用 `grep` 确认的是**整个规则块**是否
  还有别的活跃选择器，不是单个类名
- **`var(--x)` 引用的 token 必须有定义**：未定义且不带 fallback 时，整条声明在
  computed-value 阶段失效且**不报任何错**（`--surface-sub` 曾被引用 14 次而全站没定义，
  表现为背景透明）。CI 的「检查 CSS 变量都有定义」兜住这一类问题
- **暗色覆盖里凡是写死颜色（不走 token）的选择器，必须带 light 守卫**：
  `@media (prefers-color-scheme: dark)` 中的深色 rgba 若不加 `html:not([data-theme="light"])`，
  「系统深色 + 用户手动选浅色」时会把深色底漏进浅色界面。走 token 的规则不受影响，
  因为 `html[data-theme="light"]` 的特异度更高、会把 token 换回浅色值

## 七、调试技巧

生产版 Vue 会吞掉模板编译错误，**排查白屏时临时把 `index.html` 里的 `vendor/vue.global.prod.js` 换成 dev 版**，然后在控制台执行：

```js
DevVue.compile(document.querySelector('#app').innerHTML)
```

能直接拿到出错的表达式。

## 八、已知边界

**数据与题库**
- **多卷筛选**：多卷时只能在数据源面板切换卷，各模式内未做卷级筛选（默认题库是单卷，价值有限）。
- **远程导入依赖 CORS**：目标服务器不允许跨域时，改用「粘贴 JSON」或「选择文件」。
- **`file://` 下无 `data.json` 自动加载**：浏览器限制，属预期行为；PWA 也只在 http(s) 下生效。
- **`features` 开关只对两个模式生效**：`practice` / `preview` 可被 `enabled: false` 隐藏，
  在 3.0 里的效果是「隐藏练习页分段控件中的闯关队列 / 浏览速览两档」
  （映射唯一住在 `js/navigation.js` 的 `modeVisibleByFeature()`，缺键 = 可见）。
  今日 / 练习 / 错题本 / 题库四个一级导航、以及背诵 / 答题 / 按题型自测 / 模拟考试
  四个模式是无条件挂载的，`features` 隐藏不了。

**功能语义**
- **主观题没有自动判分**：填空 / 简答 / 专项题一律用户自评，没有文本比对
 （不忽略大小写、无同义词、无逐空对齐）。`|` 分隔符只在**导入时**被拆成逐空答案，
  判分路径与界面层都不消费它（详见 EXAM_JSON_SPEC.md §3.2.2）。
- **两套"掌握"模型并存**：闯关的「一次即掌握」与 progress 的「连对 5 次」互不干涉，
  见 §3.2。这不算 bug，但意味着「掌握了多少」在两个入口下数字不同。
- **恢复点按模式分桶**：`examSession:v1` 内部为 `{ version: 2, resumes: { study, exercise, exam } }`，
  开始一种模式只会覆盖它自己的桶。旧的单槽数据（`version: 1`）在读取时归还到它自己的 mode 桶，
  下一次写入时落盘为 v2，无需手动迁移。`loadResumePoint` / `clearResumePoint` 的 `mode`
  参数决定读写哪个桶；`touchResumePoint(index, mode)` 的 mode 必填，该模式桶不存在时返回 false。

**样式**
- **承载文字的填充面必须用语义「填充档」**：`--success-fill` / `--danger-fill` 是给白字压的
  深档（浅色模式 #1E7A32 / #D70015，实测 5.41 / 5.38:1）；深色模式反过来把 `--on-accent`
  压成近黑（语义色在深色下更亮，白字只剩 2.0–3.7:1，换近黑前景实测 5.76–10.39:1）。
  新增按钮/徽标不要直接拿 `--success` / `--danger` 当背景配白字，也不要在组件里写 `#fff`。
- **3.0 起主按钮不是品牌蓝**：`.btn` 的底是 `--md-ink`（浅色 #211A15 / 深色 #F5F1EB，
  与前景 `--md-ink-on` 反转），压白字约 15:1。历史遗留短名 `--primary` 现在指向
  `--md-amber` #B45309（深色 #FAC62C），它是**唯一强调色**而不是主操作色，压白字 5.3:1
  （DESIGN.md §2.3）。2.x 那条「品牌蓝 #007AFF 压白字 4.02:1 有意保留的偏差」
  随 3.0 换主题一并作废，别再照它改色。
- **作答与表单输入框是一份实现**：`.md-field`（`components.css`），多行加 `.tall`。
  曾经的 `.md-exercise-blank-input` / `.md-exercise-essay-input` / `.cat-answer-input`
  三份已合并。
- **空状态图标只有一套**：`.empty-hint::before` 的书本图标。曾经按模式切换专属图标的
  三条规则已删——它们用 `section[v-show*="..."]` 选中，而 Vue 把 `v-show` 编译成 `style`，
  DOM 里没有这个属性，规则永不命中。要按场景区分图标，请在模板上挂真实类名。

**交互**
- **卡片的左右滑动只在「看过答案 / 判过分」之后生效**，且纵向滚动始终交还浏览器
  （`touch-action: pan-y` + 一次性轴锁定）。桌面端同一段代码也接受鼠标拖拽。
- **生产版 Vue 会吞掉模板编译错误**，白屏时按 §七 换 dev 版排查。
