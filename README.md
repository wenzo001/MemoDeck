<div align="center">

# MemoDeck

**考试记忆系统** · JSON 驱动的离线刷题工具

[![v3.0](https://img.shields.io/badge/版本-v3.0-B45309?style=flat-square)](./CHANGELOG.md)
[![PWA](https://img.shields.io/badge/PWA-可安装到桌面-211A15?style=flat-square)](#pwa-安装到桌面)
[![纯静态](https://img.shields.io/badge/构建-无构建步骤-41b883?style=flat-square)](./docs/ARCHITECTURE.md)
[![离线可用](https://img.shields.io/badge/离线-完全可用-57504A?style=flat-square)](./docs/DEPLOYMENT.md)
[![Vue](https://img.shields.io/badge/Vue-3.5.13-4fc08d?style=flat-square)](https://vuejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)

**双击 `index.html` 就能用。** 不用装 Node，不用装依赖，不用联网，不用起服务器。

**🟢 在线体验：[https://wenzo001.github.io/MemoDeck/](https://wenzo001.github.io/MemoDeck/)** —— GitHub Pages 自动部署，打开即测（内容与仓库一致）

</div>

---

## 它是什么

一个把「题」和「程序」彻底分开的刷题工具。程序不认识任何一门学科，它只认识一份 JSON；你换一份 JSON，它就变成那个科目的刷题 App。

背单词、刷历史、考驾照、背法条、复习认证题库——只要能把题整理成 JSON，它就能用。配合 AI，从照片到可用题库通常只要几分钟。

## 为什么不一样

**🕹️ 真的会安排复习节奏**
不是刷完一遍就完事。「闯关队列」是会话内的：记住一次即本轮攻克、进度前移，没记住就埋到 5~7 张之后，保证中间至少隔四五道别的题才可能再次刷到，不在同一道题上原地打转。「背诵」是跨会话的：按连续答对次数排下次复习间隔（1/3/7/14/30 天），连对 5 次才算掌握。低频打扰、高频巩固，把时间花在真正记不住的题上。

**📄 题库就是 JSON，不是数据库**
可读、可改、可 diff、可版本管理。用 AI 生成、用脚本批量处理、用 Git 追踪变更，都自然而然。

**🔌 完全离线**
Vue 已本地化到 `vendor/`，零 CDN 依赖；零 Web 字体（只用系统字体栈）、零运行时库、零构建步骤，图标是内联 SVG。飞机上、内网里、U 盘里都能跑。

**🎯 考完立刻知道错在哪**
答题与按题型自测里客观题当场判分：答对约 0.6 秒后自动前进，答错停在本题、下方直接给出标准答案与解析（自测还能用「上一题」回看已答的题）；模拟考试过程中不反馈，交卷一次性判分，答题卡可回看改答，成绩页带正确率与用时，未作答单独统计。

**📕 错题本会自己变薄**
除只读的「浏览速览」（那里是你主动「记入错题本」）外，任何模式答错都会**实时**把题收进错题本（全局去重，同题只留一条），中途退出考试也不丢；空着不答的题不收进来看。离开只有一条规则：**任何入口答对都计入连对，累计 3 次自动移出**，并且移出时一定写明原因（连对 3 次自动移出 / 手动删除 / 手动标记已攻克）。剩下的永远是真正没掌握的。

**🖋 暖纸墨色，不是网页蓝**
3.0 换了整套视觉：画布 `#F8F5F0`、正文墨色 `#211A15`，琥珀 `#B45309` 是**唯一**强调色，只用在进度与到期上。主操作按钮是墨色（深色模式反转成纸底墨字），绝不用琥珀/绿/红/蓝——那四个色相已经被「到期/判对/判错/待自评」占满了。深色是暖黑 `#141210`。规格见 [设计系统](./docs/DESIGN_SYSTEM.md)。

**🤖 内置 AI 转换提示词**
点顶栏的 **AI 提示词**（星芒图标）复制提示词，配合试卷照片丢给任意大模型，直接吐出可导入的 JSON。

---

## 快速开始

### 试用（30 秒）

1. 下载或克隆本仓库
2. **双击 `index.html`**
3. 打开就是「今日」页，直接刷内置的历史示例题库（13 题）

### 用自己的题库（3 分钟）

1. 点顶栏的 **AI 提示词**（星芒图标按钮），复制提示词
2. 把提示词 + 你的题目截图/文本发给任意 AI
3. 拿回 JSON，切到 **题库** 页 → 展开「或粘贴 JSON 文本录入」→ 粘贴后点「应用粘贴的 JSON」

也可以在「题库」页直接把 `.json` 文件拖进虚线框，或点「点击选择文件」。参考格式见 [`history-example.json`](./history-example.json)。

> 想部署到网上给别人用？见 [部署指南](./docs/DEPLOYMENT.md)，从 GitHub Pages 到 Docker 都有。

---

## 四个入口

v1 是四个模式，v2 叠到 8 个 Tab——入口两两相似，用户判断不了该用哪个。3.0 收敛为 **4 个一级导航**，
练习页内用一个分段控件切六种模式，用户只需回答「这轮我要做什么」。

| 导航 | key | 干什么用 | 关键机制 |
|---|---|---|---|
| **今日** | `today` | 看今天该学什么（单一焦点） | 今日任务卡（待学数 / 到期数 / 进度 / 预计用时）、**每日目标可见可改**、近 7 天学习量、记忆四档、错题四档、恢复提示卡 |
| **练习** | `practice` | 逐题推进 | 六种模式的宿主，差异只是**判分方式**与**是否写长期进度**，属配置而非入口 |
| **错题本** | `wrongbook` | 攻克薄弱点 | 按出错来源分 Tab；「攻薄弱项」与「错题重考」降为页内两种发起方式；**连对 3 次自动移出并写明原因** |
| **题库** | `bank` | 管数据 | 原「数据管理」浮层变成一个二级页：数据接入 + 手动加题 + 导出备份 + 外观（主题、每日目标） |

### 练习页的六种模式

| 模式 | 模式 key | 内部 session mode | 判分 | 写长期进度 | 恢复点 |
|---|---|---|---|---|---|
| 背诵 | `recite` | `study` | 用户自评 | ✅ | ✅ |
| 答题 | `answer` | `exercise` | 客观题自动、主观题自评 | ✅ | ✅ |
| 按题型自测 | `bytype` | `category` | 客观题自动，答对自动前进 | ✅ | — |
| 模拟考试 | `mock` | `exam` | 交卷统一判分，过程中不反馈 | ✅ | ✅ |
| 浏览速览 | `browse` | `preview` | 不判分，只读 | ❌ | — |
| 闯关队列 | `queue` | `practice` | 用户自评（本轮攻克） | ✅ | — |

### 从 2.x 的八个入口过来

| 2.x 入口 | 3.0 位置 |
|---|---|
| 首页 | 今日 |
| 学习 | 练习 › 背诵（模式 key `recite`，内部 session mode 仍是 `study`）|
| 练习 | 练习 › 答题（`answer` / 内部 `exercise`）|
| 分类考试 | 练习 › 按题型自测（`bytype` / 内部 `category`）|
| 模拟考试 | 练习 › 模拟考试（`mock` / 内部 `exam`）|
| 摸底速览 | 练习 › 浏览速览（`browse` / 内部 `preview`）|
| 记忆闯关 | 练习 › 闯关队列（`queue` / 内部 `practice`）|
| 数据管理浮层 | 题库页 |

**只有入口换了名字。** 内部状态机、localStorage 键、会话恢复点的 `mode` 值、错题本的 `source` 值
全部沿用 2.x 原名，所以已有的进度、错题本、恢复点、备份文件**不需要任何迁移动作**，打开就接着用。
（错题本里的来源标签因此仍显示「学习 / 练习 / 记忆闯关 / 摸底速览 / 考试」这五个 2.x 名字。）

### 地址（hash）

新地址是 `#/today`、`#/practice/<mode>`、`#/wrongbook`、`#/bank`。旧书签全部仍有落点，
兼容表在 [`js/navigation.js`](./js/navigation.js)：`#/home`、`#/study`、`#/exercise`、`#/category`、
`#/exam`、`#/preview`、`#/practice`、`#/wrongbook`。

一条**刻意的歧义规则**：裸的 `#/practice` 按旧地址解释，落到「练习 › 闯关队列」——因为 2.x 里它
就是记忆闯关的入口，而 3.0 自己生成的练习页链接一定带模式段，不带模式段的只可能是旧书签。
（`#/practice/不认识的键` 不算旧地址，只退回无模式的练习页。）

### 窄屏与宽屏

导航在 **560px** 处从底部标签栏切到左侧栏。**320–359** 底部导航收为「今日 / 练习 / 更多」三栏，
错题本与题库进「更多」（这是唯一牺牲一级导航直达性的地方，360px 以上恢复四栏直达）。
答题页 **768px** 起转双栏并补上「这道题的历史」卡片；**1024px** 起选项带键位徽标、侧栏常驻快捷键面板；
数字角标（今日待学数、错题数）只在宽屏侧栏出现。七档断点 **320 / 360 / 430 / 560 / 768 / 1024 / 1440**
已在真实浏览器逐档实测。规格见 [设计系统 §5.3](./docs/DESIGN_SYSTEM.md)。

> 「背诵」与「闯关队列」是两套并行的记忆模型（前者跨会话、连对 5 次算掌握；后者会话内、
> 一次即「本轮攻克」，3.0 特意改了名以免被读成跨会话的「已掌握」）。这是 v2 叠加新功能留下的
> 历史结构，3.0 只重组了入口、没有合并它们，差别见 [架构设计 §3.2](./docs/ARCHITECTURE.md)。

---

## 题库 JSON 长什么样

```json
{
  "view": "exam-bank",
  "viewVersion": "1.0.0",
  "meta": {
    "title": "初中历史题库",
    "description": "可替换任意学科"
  },
  "features": {
    "practice": {
      "enabled": true,
      "label": "记忆闯关",
      "icon": "🕹️",
      "config": {
        "passLabel": "😎 记住了 (剔除)",
        "failLabel": "😥 没记住 (重刷)"
      }
    }
  },
  "papers": [
    {
      "id": "历史示例",
      "name": "初中历史·示例卷",
      "questions": [
        {
          "id": 1,
          "type": "fill_blank",
          "group": "填空题",
          "question": "我国有文字可考的历史开始于____朝。",
          "blanks": [{ "index": 1, "answer": "商" }]
        },
        {
          "id": 2,
          "type": "single_choice",
          "group": "单项选择题",
          "question": "秦始皇统一六国是在哪一年？",
          "options": { "A": "前230年", "B": "前221年", "C": "前210年" },
          "answer": "B",
          "explanation": "前221年秦灭齐，完成统一。"
        }
      ]
    }
  ]
}
```

### 支持的题型

| `type` | 题型 | 必需字段 |
|---|---|---|
| `fill_blank` | 填空题 | `question` + `blanks: [{index, answer}]` |
| `true_false` | 判断题 | `question` + `answer: true/false` |
| `single_choice` | 单选题 | `question` + `options: {A,B,C}` + `answer: "A"` |
| `multi_choice` | 多选题 | `question` + `options` + `answer: ["A","B"]` |
| `essay` | 问答题 | `question` + `answer: "文本"` |
| `special_fill_blank` | 专项题 | `question` + `blanks` |

六种题型各自注册到题型注册表（`js/types.js`），**未注册的 `type` 走 `DefaultRenderer` 只读兜底**：
显示题干与 `answer` 原始字段、不解析结构、不提供作答、不写进度，题型标签直接显示原始 `type` 字符串，
方便你把没认出来的题型反馈给部署者。不会崩，也不会静默吃掉你的题。

**填空是逐空输入**——一个空一个输入框，空位序号显式。题库里的多空写法 `"鸦片|1840"`
继续有效，但 `|`（含全角 `｜`）**只在导入时**拆成逐空答案，界面上再也不出现分隔符、
也不用手写。优先级：显式 `blanks` 数组 > `answer` 按 `|` 拆 > 按题干 `____` 数量补空位。
判分仍是用户自评，没有文本比对。专项题复用填空组件，只有序号色从琥珀改成蓝。

`features` 是**声明式开关**，3.0 沿用 2.x 的键名——不改名、不删除，只是含义挪到了模式上：
`features.practice.enabled: false` 隐藏练习页的「闯关队列」模式，`features.preview.enabled: false`
隐藏「浏览速览」模式；**缺键 = 可见**，所以不含任何新字段的旧题库 JSON 照常工作。
`config.passLabel` / `failLabel` 仍可覆盖闯关的自评按钮文案。

完整规范：[`docs/EXAM_JSON_SPEC.md`](./docs/EXAM_JSON_SPEC.md) · Schema：[`exam-bank.schema.json`](./exam-bank.schema.json)

---

## 项目结构

```
memodeck/
├── index.html              # HTML 骨架 + Vue 模板（in-DOM template）
├── config.js               # 运行配置（远程题库地址 / JSON 管理服务入口）
├── default-bank.js         # 内置兜底题库（离线首启用）
├── css/
│   ├── tokens.css                # Design Token：暖纸墨色 + 琥珀（浅色一份 :root，深色一份 html[data-theme="dark"]）
│   ├── themes.css                # 主题切换控件（深色值已收进 tokens，这一层刻意几乎为空）
│   ├── components.css            # 应用栏 / 导航 / 按钮 / 选项块 / 芯片 / 横幅 / 卡片组件
│   ├── pages.css                 # 今日 / 练习（六种模式）/ 错题本 / 题库 页面
│   ├── responsive.css              # 七档断点 320/360/430/560/768/1024/1440（只改布局 token 取值）
│   └── accessibility.css         # a11y: focus-visible / reduced-motion
├── js/
│   ├── core.js                   # 纯逻辑：格式识别、归一化、条目构建
│   ├── navigation.js             # 3.0 导航模型：4 个入口 + 6 种模式 + 旧地址兼容表 + 旧开关键名映射
│   ├── types.js                  # 3.0 题型注册表：六种控件（逐空/圆点/方框/大按钮/文本域）+ DefaultRenderer 兜底
│   ├── judge.js                  # 3.0 判分口径：全局唯一的一份实现，不许有第二套
│   ├── components.js             # 3.0 跨页共享组件：判分横幅 / 参考答案 / 状态芯片 / 三联格 / 口径条 / 恢复卡 / 本题历史
│   ├── store.js                    # localStorage 缓存 + 错题本存储
│   ├── leitner.js                  # Leitner 间隔重复算法
│   ├── wrongbook.js                # 错题本状态机（3.0 单一离开规则 + 移出留痕）
│   ├── progress.js                 # 学习进度持久化
│   ├── session.js                  # 考试/练习会话恢复 + 每日任务生成
│   ├── stats.js                    # 统计看板聚合
│   ├── migration.js                # v1→v2 数据迁移
│   ├── backup.js                   # 一键备份/恢复
│   ├── utils.js                    # 轻量工具（shuffle/groupBy）
│   ├── queue.js                    # 取题管线（范围→题型→排序→截断，纯逻辑）
│   ├── ai-prompt.js                # AI 题库转换提示词
│   └── app.js                      # Vue 应用：全部状态与交互
├── vendor/
│   └── vue.global.prod.js  # 本地 Vue 3.5.13（离线依赖）
├── assets/                       # PWA 图标
│   ├── logo.svg                   #   矢量源文件
│   ├── icon-192.png               #   192×192（桌面/任务栏）
│   └── icon-512.png               #   512×512（开始菜单/启动画面）
├── manifest.json                  # PWA 应用清单
├── service-worker.js              # PWA 离线缓存（HTML network-first, 静态 cache-first）
├── test/
│   ├── core.test.js              # 纯逻辑单元测试（26 项，零依赖）
│   ├── queue.test.js              # 取题管线测试（21 项，含 48 组合不变式遍历）
│   ├── extensions.test.js         # 扩展测试（progress/session/stats/migration/wrongbook，41 项）
│   ├── v3-compat.test.js          # 3.0 兼容与规则测试（41 项：导航映射、逐空拆分、题型注册、单一离开规则、命名消歧、判分口径唯一性、模板接线守卫）
│   ├── icons.test.js              # §4.5 图标构建规则的静态守卫（6 项：零外边距名单与模板双向差集、四档 22/24/30/44 各有主人）
│   └── virtual.test.js            # 长列表窗口化的算术（14 项：偏移表、二分定位、窗口区间、稀疏记账合同）
├── docs/
│   ├── USAGE.md            # 使用说明
│   ├── ARCHITECTURE.md     # 架构设计（面向二次开发）
│   ├── DEPLOYMENT.md       # 部署指南
│   ├── EXAM_JSON_SPEC.md   # 题库 JSON 规范
│   ├── DESIGN_SYSTEM.md    # 设计系统（3.0 界面的权威规格：颜色/字体/组件/布局/命名）
│   ├── DESIGN_HANDOFF.md   # 设计交接说明
│   └── MemoDeck 3.0 设计系统与界面.pptx   # 设计稿交付物（12 张画板）
├── data.json               # 你的题库（可选，已被 .gitignore 排除）
├── history-example.json    # 示例题库
├── exam-bank.schema.json   # JSON Schema
├── Dockerfile              # nginx:alpine，约 10MB
└── LICENSE                 # MIT
```

---

## 部署

纯静态，没有构建步骤。任何能托管 HTML 的地方都行。

| 方式 | 适合场景 | 说明 |
|---|---|---|
| **双击 `index.html`** | 个人单机 | 零部署，完全离线 |
| **本地服务器** | 开发验证 | `python3 -m http.server 8000` |
| **GitHub Pages** | 公开分享 | ✅ 已启用，推到 `main` 自动部署 |
| **Nginx / Apache** | 自建服务器 | 配置见部署指南，含 CORS |
| **Vercel / Netlify** | 免运维托管 | 连接 Git 自动部署 |
| **Docker** | 容器化 | `docker build -t memodeck . && docker run -p 8080:80 memodeck` |

详细步骤与配置片段见 [部署指南](./docs/DEPLOYMENT.md)。

> 本项目已上线：**[https://wenzo001.github.io/MemoDeck/](https://wenzo001.github.io/MemoDeck/)**（2026-09-04 跑通，内置 13 题示例历史题库，可直接试用全部功能）。每次推送 `main` 自动更新。

---

## 文档

| 文档 | 面向 | 内容 |
|---|---|---|
| [使用说明](./docs/USAGE.md) | 使用者 | 导入题库、四个入口与六种练习模式、从 2.x 升级、AI 生成、数据存储、常见问题 |
| [部署指南](./docs/DEPLOYMENT.md) | 部署者 | 6 种部署方式、配置片段、CORS、自检清单 |
| [架构设计](./docs/ARCHITECTURE.md) | 开发者 | 模块划分、数据流、算法细节、模板书写约定 |
| [JSON 规范](./docs/EXAM_JSON_SPEC.md) | 题库作者 | 完整字段定义、题型结构、旧格式兼容 |
| [设计系统](./docs/DESIGN_SYSTEM.md) | 改界面的人 | 3.0 界面的权威规格：颜色（§2）、字号阶（§3）、组件契约（§4）、布局与信息架构（§5）、禁止项与命名消歧（§7.1/§7.3）、已决策事项（§7.4） |
| 设计稿 | 使用者 / 评审 | `docs/MemoDeck 3.0 设计系统与界面.pptx`——12 张画板（390 今日·答题·判错反馈·成绩、深色判错反馈、768 平板、900 折叠屏展开、430 折叠屏折叠、1440 桌面、320 答题·今日、六种题型控件对照） |

---


---

## PWA：安装到桌面

v2.0 起支持渐进式网页应用（PWA）。安装后桌面出现图标，独立窗口打开（无地址栏），断网也能用。

### 安装步骤

> ⚠️ PWA 必须走 **http/https** 协议，**双击 file:// 不触发**（浏览器安全限制）。

```bash
# 方式 A: 本地启动
python3 -m http.server 8000
# 打开 http://localhost:8000

# 方式 B: 部署到 GitHub Pages / Vercel / Netlify（任何 https 静态托管）
# 已部署实例: https://wenzo001.github.io/MemoDeck/
```

然后：

| 浏览器 | 安装入口 |
|---|---|
| **Chrome / Edge** | 地址栏右侧 ⊕ / + / 安装图标 → 点「安装」 |
| **Safari (macOS)** | 文件 → 添加到程序坞 |
| **手机 Chrome** | 菜单 → 添加到主屏幕 |

### 离线能力

首次在线打开后，Service Worker 会预缓存 `service-worker.js` 里 `PRECACHE_URLS` 列出的全部静态资源（HTML / CSS / JS / vendor / 图标）。新增文件时记得同步该清单——漏掉的文件在断网时取不到。之后：

- **HTML**：network-first（每次打开先尝试网络，失败回退缓存）
- **静态资源**：cache-first + stale-while-revalidate（先秒开缓存，后台静默更新）

更新缓存：修改 `service-worker.js` 顶部 `VERSION` 字符串，用户下次打开旧缓存自动清除、新资源预缓存。

### 文件说明

| 文件 | 作用 |
|---|---|
| `manifest.json` | 应用清单：名称、图标、主题色（暖纸 `#F8F5F0`，深色 `#141210`）、`display:standalone`（独立窗口），外加「今日 / 答题 / 模拟考试 / 错题本」四个直达快捷方式 |
| `service-worker.js` | 离线缓存策略 |
| `assets/icon-192.png` / `icon-512.png` | 应用图标：墨底 `#211A15` + 纸色卡面 + 琥珀对勾，与 3.0 界面同一套色（`css/tokens.css`）。源文件是矢量的 `assets/logo.svg`，改完跑 `node tools/make-icons.mjs` 重新栅格化（需要 devDependency `sharp`，应用运行时依旧零依赖）。图标内容全部落在中心安全区内，因为 manifest 声明了 `purpose: "any maskable"` |

---

## 常见问题

**双击打开是白屏？**
检查 `css/`、`js/`、`vendor/` 是否与 `index.html` 在同一目录，相对路径不能断。另外需要支持 ES2015+ 的现代浏览器。

**放了 `data.json` 没加载？**
`file://` 协议下浏览器禁止 `fetch` 本地文件，属安全限制。用本地服务器打开，或直接拖拽文件导入。

**远程链接导入失败？**
目标服务器需允许跨域（CORS）。不允许就改用「粘贴 JSON」或「选择文件」。

**数据存在哪？**
浏览器 localStorage，共 9 个在用的 `exam*` / `memo:*` 键：题库缓存 `examBankCache:v2`、
错题本 `examWrongbook:v1`（运行时唯一真相源）与 `examWrongbook:v2`（迁移快照，只由
migration 写、供导出用）、学习进度 `examProgress:v1`、会话恢复点 `examSession:v1`、
设置（含每日目标）`examSettings:v1`、闯关队列 `examLeitnerQueue:v1`、
主题 `memo:theme`、练习页上次用的模式 `memo:practiceMode`。持久化细节见
[架构设计 §4.3](./docs/ARCHITECTURE.md)。3.0 只改了入口名，**这些键名一个都没动**，
旧数据直接接着读。另有 2 个 `examBankCache:v0/v1` 旧键会在启动时被主动清掉。
不上传任何服务器。换设备请在「题库 › 导出与备份」用**导出备份**导出全量备份、另一台**导入备份**
（只下载题库 JSON 不含进度与错题）。

**2.x 的「数据管理」按钮找不到了？**
它不再是右上角的浮层，而是「题库」这个一级页：数据接入、手动加题、导出备份、外观（主题与每日目标）
都在那一页里，按分组往下排。

**手动加的题刷新就没了？**
是的，这是已知限制：「手动加题」只写内存，界面上那个分组里也明明白白写着这一条。要长期保留就
导出备份，或者把题写回你的题库 JSON。

更多见 [使用说明 · 常见问题](./docs/USAGE.md#七常见问题)。

---

## 参与开发

技术栈：Vue 3.5.13（全局构建）+ 原生 CSS + 原生 JS，**无构建工具**。

这是刻意的选择——为了保住「双击即用」这个核心体验。改动时请遵守：

1. **不引入构建步骤**，不引入 ES Module（`file://` 下会被 CORS 拦截）；
   **不引入 Web 字体、不引入运行时库、不引入图标 CDN、不引入动画库**——字体只用系统字体栈，
   图标全部是内联 `<symbol>`（3.0 的界面里没有一处 emoji 图标）
2. **纯逻辑不碰 DOM/Vue**：`core` / `store` / `leitner` / `wrongbook` / `utils` / `queue` /
   `navigation` / `judge` / `types` / `migration` / `progress` / `session` / `stats` 保持可单测；
   能脱离响应式系统成立的逻辑就往这些模块里挪，别留在 `app.js`
3. **模板属性值内不写 `>` 或 `=>`**，抽成 computed（原因见 [架构设计](./docs/ARCHITECTURE.md#五模板书写约定重要)）
4. **新增题型**要动这几处：`core.js` 的 `TYPE_REGISTRY` + `normalizeQuestion()`/`renderAnswer()` +
   `js/types.js` 注册作答控件（不注册就只走 `DefaultRenderer` 只读兜底，能看不能答）+
   系统判分的题型还得进 `js/judge.js` 的 `OBJECTIVE_TYPES` + 模板里各模式的题型勾选框
5. 保持 44px 触摸目标（不分宽度，桌面也是）、可见焦点态、`prefers-reduced-motion` 降级；
   状态一律「形状 + 文字 + 颜色」三线索，颜色只是冗余线索
6. **同一个行为只允许有一份实现**：判分 `js/judge.js`、题型控件 `js/types.js`、状态芯片词表
   `js/components.js`、取题 `ExamQueue`、计时器 `makeSessionTimer`、滑动 `makeSwipe`
   都是这么收敛来的，加新模式时复用而不是再抄一份
7. **改界面先读 [设计系统](./docs/DESIGN_SYSTEM.md)**：§7.1 禁止项（不用渐变背景、不用 emoji
   当图标、主按钮不用琥珀/绿/红/蓝）、§7.2 六条必须显示的口径、§7.3 命名消歧（记忆侧「新题/学习中/
   需复习/已掌握」与错题侧「新错/巩固中/模糊/已攻克」是两个不同的数，绝不同名、不可相加）都是硬约束
8. **入口改名只许动 `js/navigation.js` 的映射表**：模式 key 可以换，但内部 session mode 值、
   localStorage 键名、错题 `source` 值不能跟着改——那三样是用户的数据，改了就是丢进度

本地验证：

```bash
# 单元测：纯逻辑与静态文本，零依赖、零框架、零构建（六个套件共 149 项）
npm test

# 等价于
node test/core.test.js && node test/queue.test.js && node test/extensions.test.js && node test/v3-compat.test.js && node test/icons.test.js

# 浏览器：起个静态服务器
python3 -m http.server 8000   # 打开 http://localhost:8000
```

推送后会跑 CI，九道检查：单元测试（六个套件 149 项）、版本号三处一致、PWA 预缓存清单覆盖页面全部资源、
JS 语法、Vue 模板表达式安全（防白屏）、关键文件完整、文档链接可达、CSS 变量都有定义、对比度不变量。
规则见 [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)，本地可直接复现。

CI 只能跑不依赖浏览器的检查。**真视口下的几何门禁不在 CI 里**：七档断点的留白/侧栏/分栏宽度、
触摸目标 ≥44、文案不截断、六模式全流程判分呈现、2.x 数据升级路径，以及 §4.5 的
「22/24/30/44 四档字形全部居中」——这些需要一个真 Chromium 逐档量
`getBoundingClientRect()`，用固定断言脚本在每次动过布局后手工跑一次。

---

## 许可

[MIT](./LICENSE) — 自由使用、修改、分发。

第三方依赖：[Vue.js](https://vuejs.org/) 3.5.13（MIT），已本地化在 `vendor/`。
