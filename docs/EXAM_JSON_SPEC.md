# 试卷 JSON View 标准

> 版本：`viewVersion = "1.0.0"`
> 用途：为「MemoDeck」定义一套**可扩展**的试卷 JSON 数据格式（View 层）。
> 以后新增任何卷子，只需按本标准生成一份 JSON（远程托管、或粘贴、或放进 `data.json`），应用即可加载并运行。

---

## 1. 设计目标

1. **可扩展（Extensible）**：新增卷子、新增题型、新增应用功能时，**不需要**改动应用主逻辑，只扩充 JSON。
2. **版本化（Versioned）**：通过 `viewVersion` 协商格式，应用可兼容多版本。
3. **声明式（Declarative）**：JSON 既是数据，也声明了「应用要运行哪些功能」（`features`）。
4. **自描述（Self-describing）**：`meta` 携带标题、标签、时间等元信息，便于展示与检索。
5. **向后兼容（Backward-compatible）**：解析器同时接受本标准（`papers` 数组）与旧格式（顶层卷子键 + 分题型对象），并自动归一化。

---

## 2. 顶层结构（Envelope）

```json
{
  "$schema": "https://example.org/exam-bank.schema.json",
  "view": "exam-bank",
  "viewVersion": "1.0.0",
  "meta": {
    "title": "考试题库（示例）",
    "description": "通用考试题库示例",
    "author": "",
    "updatedAt": "2026-09-01T00:00:00Z",
    "tags": ["示例", "考试"]
  },
  "features": { "...": "见 §4" },
  "papers": [ { "...": "见 §3" } ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `view` | string | 是 | 视图标识，固定为 `"exam-bank"`，解析器据此识别格式。 |
| `viewVersion` | string | 是 | 本标准的版本号，用于协商与兼容判断。 |
| `meta` | object | 是 | 元信息，见 §2.1。 |
| `features` | object | 否 | 声明应用运行哪些功能及其配置，见 §4。 |
| `papers` | array\<Paper\> | 是 | 卷子列表，可任意多份，见 §3。 |

### 2.1 `meta`（元信息）
自由键值对，所有字段可扩展。常用：

```json
"meta": {
  "title": "考试题库（示例）",
  "description": "一卷一档，自描述说明",
  "author": "编辑部",
  "updatedAt": "2026-09-01T00:00:00Z",
  "tags": ["示例", "考试"],
  "language": "zh-CN",
  "source": "https://example.com/source.pdf"
}
```

---

## 3. 卷子（Paper）

```json
{
  "id": "卷1",
  "name": "示例试卷",
  "order": 1,
  "questions": [ { "...": "见 §3.1" } ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string/number | 卷子唯一标识（如 `"卷1"`、`"卷2"`）。 |
| `name` | string | 展示名。 |
| `order` | number | 可选，排序值（小的在前）。 |
| `questions` | array\<Question\> | 题目列表，见 §3.1。 |

> 一个文件可放多份卷子。应用提供「切换卷子」能力；若只有一份，则直接显示。

---

## 3.1 题目（Question）— 判别联合（Discriminated Union）

`question.type` 决定题目的结构。通用字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string/number | 卷内唯一。 |
| `type` | string | 题型标识（判别字段，必填）。 |
| `question` | string | 题干。填空/专项题中，空位用 `____` 预留。 |
| `group` | string | 可选，所属栏目标签（如 `"填空题"`）；不填由应用根据 `type` 推断。 |
| `tags` | array\<string\> | 可选标签。 |
| `explanation` | string | 可选解析/说明。 |

### 3.1.1 题型一览

| `type` | 含义 | 结果字段 |
|---|---|---|
| `fill_blank` | 填空题 | `blanks` |
| `true_false` | 判断题 | `answer`（boolean） |
| `single_choice` | 单项选择题 | `options` + `answer`（单个键） |
| `multi_choice` | 多项选择题 | `options` + `answer`（键数组） |
| `essay` | 问答题 | `answer`（文本） |
| `special_fill_blank` | 专项题 | `blanks`（结构同填空题） |

### 3.1.2 各题型示例

**填空题 / 专项题**（`fill_blank` / `special_fill_blank`）

```json
{
  "id": 1,
  "type": "fill_blank",
  "question": "中国近代史的开端是____战争，爆发于____年。",
  "blanks": [
    { "index": 1, "answer": "鸦片" },
    { "index": 2, "answer": "1840" }
  ]
}
```
- `blanks`：数组，`index` 从 1 开始；`answer` 为该空的标准答案。
- 题干中的 `____` 与 `blanks` 一一对应（可不严格对齐，应用按顺序展示）。
- **旧写法仍然有效**：不给 `blanks`、只给一条用竖线分隔的 `answer` 字符串，
  应用在**导入时**拆成逐空数组。下面两种写法在 3.0 里渲染结果完全相同：

```json
{ "id": 2, "type": "fill_blank", "question": "……开端是____战争，爆发于____年。",
  "answer": "鸦片|1840" }
```

  半角 `|` 与全角 `｜` 都接受，空段丢弃；显式 `blanks` 数组优先于 `answer` 拆分。
  `special_fill_blank`（专项题）结构与此完全一致，界面上复用同一套逐空控件，
  只有序号颜色不同（普通填空琥珀、专项题蓝）。

**判断题**（`true_false`）

```json
{
  "id": 1,
  "type": "true_false",
  "question": "武则天是我国历史上唯一的女皇帝。",
  "answer": true
}
```
- `answer`：`true`=正确，`false`=错误。

**单项选择题**（`single_choice`）

```json
{
  "id": 1,
  "type": "single_choice",
  "question": "我国历史上第一个统一的中央集权封建王朝是（ ）。",
  "options": { "A": "夏", "B": "商", "C": "秦", "D": "汉" },
  "answer": "C"
}
```
- `options`：键为选项字母（`"A"`、`"B"`…），值为选项文本。
- `answer`：单个选项键。
- **展示**：选项会随题干一起渲染，逐行显示为 `A. xxx`、`B. xxx`、`C. xxx`…，便于学习与背诵答案。

**多项选择题**（`multi_choice`）

```json
{
  "id": 1,
  "type": "multi_choice",
  "question": "我国古代“四大发明”包括（ ）。",
  "options": { "A": "造纸术", "B": "指南针", "C": "火药", "D": "印刷术" },
  "answer": ["A", "B", "C", "D"]
}
```
- `answer`：选项键数组。
- **展示**：选项随题干逐行渲染（`A. xxx`、`B. xxx`…）；答案显示为 `A, B, C, D`。

> **重要**：凡带 `options` 的题目（单选/多选），`options` 为必填字段，应用会自动把选项渲染到题干下方；缺少 `options` 时该题只显示题干与答案字母。

**问答题**（`essay`）

```json
{
  "id": 1,
  "type": "essay",
  "question": "简述秦始皇巩固统一的措施。",
  "answer": "政治上建立中央集权制度（皇帝制度、三公九卿制、郡县制）；文化上统一文字（小篆）；经济上统一度量衡、统一货币（圆形方孔半两钱）；交通上修驰道、统一车轨；军事上北击匈奴、修筑长城，南征百越。"
}
```

### 3.1.3 未知题型（兜底）
应用对 `answer` 字段做通用兜底渲染：未知 `type` 仍能显示题干，并把 `answer`（字符串）作为答案展示，同时提示「未知题型」。因此扩展新题型时，**旧应用也不会崩**。

---

## 3.2 判分规则（如何算对）

本节定义应用**消费** `answer` 字段的方式。数据侧只要按 §3.1.2 的形状给 `answer`，判分行为就是确定的。

唯一实现处：`js/judge.js` 的 `ExamJudge.judge(item, choice, multiSel)`（3.0 起从 `app.js`
的 Vue 闭包里挪出来，为的是能被 Node 单测直接打到）。`app.js` 的
`judgeObjective()` 只是一行转发。背诵 / 答题 / 按题型自测 / 模拟考试四个模式共用同一份，
不存在第二套判分逻辑 —— 并且有一条反向门禁：判分公式的签名若出现在 `judge.js`
以外的任何 js 文件里，`test/v3-compat.test.js` 会红并指名文件。

### 3.2.1 客观题（系统自动判分）

`isObjective(rawType)` 为真的三种题型：

| 题型 | 判对条件 | 未作答 |
|---|---|---|
| `true_false` | 所选 `'true'` / `'false'` 与 `answer`(boolean) 一致 | **判错**（不送分） |
| `single_choice` | 所选选项字母与 `answer`(string) 全等 | **判错** |
| `multi_choice` | 所选字母集合与 `answer`(array) **排序后全等** | **判错** |

- **多选题没有部分给分**：漏选、多选、错选都算整题错。
- `answer` 形状不符约定（例如多选写成字符串 `"AB"`）时按空集处理，该题**永远判不对**，但不会抛错、不会崩页面。请严格按 §3.1.2 给形状。

### 3.2.2 主观题（不自判，由用户对照参考答案评定）

`fill_blank` / `special_fill_blank` / `essay` 三类，系统**不做任何文本比对**：

- **没有逐空判分**。3.0 起填空题改为**逐空输入**（每空一个输入框，序号显式），
  界面上不再出现分隔符。题库里用 `|` 写多空答案的老格式**继续有效**：
  它在**导入时**被 `core.js` 的 `normalizeBlanks()` 拆成 `blanks` 数组
  （`"鸦片|1840"` → `[{index:1,answer:"鸦片"},{index:2,answer:"1840"}]`），
  半角 `|` 与全角 `｜` 都接受，空段丢弃。
  优先级：显式 `blanks` 数组 > `answer` 按 `|` 拆 > 按题干 `____` 数量补空位。
  **数据侧不需要为 3.0 改写任何题库文件。**
- 需要文本自动比对（忽略大小写/空白、逐空对齐、同义词）的话，那是尚未实现的能力，不要按它来出题。
- 题干里的 `____`（≥2 个下划线）在界面上渲染成下划线占位块；它同时决定
  `blanks` 缺失时该渲染几个输入框。题干内容会先转义再拼标记，题库里的 HTML 不会被执行。

各模式的自评入口（3.0 的界面措辞已统一为「算我答对 / 还是答错」）：

| 模式（3.0 名 / 内部 session mode） | 流程 |
|---|---|
| 背诵 `recite` / `study` | 无「作答」概念，只有「记住了 / 还不会」的自评 |
| 答题 `answer` / `exercise` | 提交后揭示参考答案 → 点「算我答对 / 还是答错」 |
| 按题型自测 `bytype` / `category` | 提交后揭示参考答案 → 点「算我答对 / 还是答错」 |
| 模拟考试 `mock` / `exam` | 交卷时已作答的主观题进入「待自评」，在成绩页对照参考答案评定后才计入对/错 |

### 3.2.3 未作答的处置

只有**模拟考试**区分「未作答」与「答错」：未作答的题不计分、不写学习进度、不进错题本，在成绩页单列一区供回卷。交卷前会弹出未答题数确认（3.0 起是应用内对话框，正文点名题数与后果，不再用 `window.confirm`）。

答题与按题型自测要求先作答（提交按钮在未作答时禁用）；一旦提交，空白一律判错——判分函数本身不会因为"没选"而送分。

模拟考试的「正确率」分母是**已判分题数**（答对 + 答错），不含待自评与未作答，成绩页有口径说明。

### 3.2.4 判分 ≠ 掌握度

判分只产出**当次**的对/错。跨会话的学习状态由 `js/progress.js` 独立维护：每次判分结果喂给 `markPass` / `markFail`，按连续答对次数 `streak` 排下次复习间隔（`1 → 3 → 7 → 14 → 30` 天），连对 5 次标记 `mastered`。

因此「这道题答对了」和「这道题掌握了」是两个不同的数，界面分别显示（3.0 起分别叫
「答对/答错」与「已掌握」，且界面上永远写明两者不可相加）。

**错题本的离开规则（3.0 收敛为一条）**：答错的题按 `gid` 全局去重进错题本；
此后**任何入口**（背诵自评、答题、按题型自测、模拟考试评定、闯关队列、错题重练）
答对都计入连对，累计连对 3 次自动移出，且移出时告知原因。
手动删除与手动标记已攻克同样留痕，原因分开记。

> 2.x 这里是三条并行规则：错题重练连对 3 次移出、**错题重考答对 1 次即移出**、
> 其它入口答对根本不计次。3.0 删掉了那条「答对 1 次就短路移出」的分支——
> 它让「错题重考」成了一条比日常复习更宽松的出本通道，同一道题换个入口就能一次出本。
> 行为变化对用户可见：现在在背诵或答题里答对一道错题，也会推进它的出本进度。
> 唯一实现是 `js/wrongbook.js` 的 `creditCorrectByGid()`，
> 不在错题本里的题它是 no-op（绝不因为答对一道本来没错的题而凭空造一条错题记录）。

---

## 4. 功能声明（features）

`features` 用「声明式」告知应用加载后要运行哪些功能及其配置。这是「远程运行」的核心：**JSON 决定应用运行什么**。

```json
"features": {
  "practice": {
    "enabled": true,
    "label": "记忆闯关",
    "icon": "🕹️",
    "config": {
      "shuffle": true,
      "passLabel": "😎 记住了 (剔除)",
      "failLabel": "😥 没记住 (重刷)"
    }
  },
  "preview": {
    "enabled": true,
    "label": "摸底速览",
    "icon": "📝",
    "config": { "showAnswers": true }
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `enabled` | boolean | 是否启用该功能；为 `false` 时应用隐藏对应模式。 |
| `label` | string | 功能展示名。 |
| `icon` | string | 图标（emoji 或文本）。 |
| `config` | object | 该功能的可扩展配置项。 |

**目前应用真正消费的 `features` 键只有 `practice` 和 `preview` 两个**，键名必须与之一致：

| 键 | 2.x 对应入口 | 3.0 对应位置 | `enabled: false` 效果 |
|---|---|---|---|
| `practice` | 🕹️ 记忆闯关（一级 Tab） | 练习 › 闯关队列（分段控件里的一档） | ✅ 隐藏该模式；`config` 仍生效，`label`/`icon` 3.0 起不再消费 |
| `preview` | 📝 摸底速览（一级 Tab） | 练习 › 浏览速览 | ✅ 隐藏该模式 |
| `exam` | — | — | ❌ `exam` 不是速览，写在这里不会有任何效果 |

> **3.0 的兼容性承诺（DESIGN.md §7.4.2 已决策）**：这两个**旧键名不改名、不删除**，
> 也不引入第二个开关契约。部署者对 `practice` / `preview` 的既有认知继续有效，
> 只是含义从「隐藏一个入口」变成「隐藏练习页里的一个模式」。
> **省略 `features`、或省略其中某个键 = 该模式可见** —— 不含任何新字段的旧题库 JSON
> 必须在 3.0 上原样正常工作，这条由 `test/v3-compat.test.js` 守着。
> 开关的映射实现唯一住在 `js/navigation.js` 的 `modeVisibleByFeature()`。

> ⚠️ 历史版本的本规范曾把 `exam` 键示例标注为「摸底速览」——那是错的：应用里
> `exam` 是模拟考试、`preview` 才是摸底速览。出题时请按上表用键名。

3.0 的一级导航只有 **今日 / 练习 / 错题本 / 题库** 四个，全部无条件挂载，
`features` 隐藏不了它们。原先的八个入口收敛关系见 [架构设计 §三](./ARCHITECTURE.md)
与 [USAGE.md](./USAGE.md) 的映射表。

`icon` 与 `label` 两个字段自 3.0 起**不再被消费**：
- `icon`：设计系统 §7.1 禁止用 emoji 做图标（跨平台渲染不一致），界面图标一律走
  `index.html` 的内联 SVG 符号表。
- `label`：模式名收敛进了 `js/navigation.js` 的 `PRACTICE_MODES` 词表，与 §7.3 的
  命名消歧绑定（同一批词在错题本/记忆进度里各有分工），不允许再被单个题库 JSON 改写。

这两个字段仍会被解析、仍可以写，写进来的内容不会报错，但也不会显示 —— 保留它们是为了
不让老题库 JSON 因为多了一个字段而变得不合法。

**仍然生效的 `config` 子键**（`practice.config`）：

| 子键 | 作用 | 缺省 |
|---|---|---|
| `passLabel` / `failLabel` | 闯关队列两张按钮的文案 | 「记住了」/「没记住」（3.0 去掉了默认的 emoji） |
| `shuffle` | 闯关取题是否洗牌 | `true`（显式写 `false` 才不洗） |

---

## 5. 扩展性机制（How to extend）

| 想扩展什么 | 怎么做 |
|---|---|
| **新增一份卷子** | 在 `papers` 数组加一项 `{ id, name, questions }`，无需改应用。 |
| **新增一个题型** | ① 在题目里给新 `type`；② 在 §3.1.1 注册它的结果字段约定；③ 在应用 `TYPE_REGISTRY` 加一个 `{label, order}` 分支。旧应用对未知 `type` 走兜底渲染，不会出错。 |
| **新增一个应用功能** | ① 在 `features` 加一个 `{enabled,label,icon,config}`；② 在应用注册对应模式下，读取 `config`。 |
| **升级格式** | 升 `viewVersion`，在解析器中按版本分支处理；旧版本仍兼容。 |

**题型与应用的映射（约定）**
应用内置 `TYPE_REGISTRY`：
```js
const TYPE_REGISTRY = {
  fill_blank:          { label: '填空题', order: 1 },
  true_false:          { label: '判断题', order: 2 },
  single_choice:       { label: '单选题', order: 3 },
  multi_choice:        { label: '多选题', order: 4 },
  essay:               { label: '问答题', order: 5 },
  special_fill_blank:  { label: '专项题', order: 6 }
};
```

---

## 6. 格式识别（兼容旧版）

- **新格式**：顶层 `.view === "exam-bank"` 且 `.papers` 为数组。
- **旧格式**（兼容）：顶层直接是卷子键（如 `"卷1" / "卷2"`），其 `questions` 为分题型对象（`填空题`/`判断题`/`单项选择题`/`多项选择题`/`问答题`/`专项题`）。

解析器统一归一化为本文档内部结构后再渲染，因此**旧 JSON 依然可用**。

---

## 7. 附：最小可用示例

```json
{
  "view": "exam-bank",
  "viewVersion": "1.0.0",
  "meta": { "title": "考试题库（示例）" },
  "features": {
    "practice": { "enabled": true, "label": "记忆闯关", "icon": "🕹️" },
    "preview": { "enabled": true, "label": "摸底速览", "icon": "📝" }
  },
  "papers": [
    {
      "id": "示例卷",
      "name": "示例卷",
      "questions": [
        { "id": 1, "type": "single_choice", "question": "1+1=?", "options": { "A": "1", "B": "2" }, "answer": "B" },
        { "id": 2, "type": "true_false", "question": "地球是圆的。", "answer": true }
      ]
    }
  ]
}
```
