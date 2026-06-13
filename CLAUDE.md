# CLAUDE.md

> 本文件是 Dev Config Hub 的仓库级共享 SSOT，记录仓库基础、目录架构、改动后要求、plan/review 生命周期、review 过期规则、文件大小护栏、项目特定不变量和验证流程。
> `AGENTS.md` 是配套入口，只记录运行时 / 工具机制差异；共享规则放在这里，避免两份入口漂移。

## 仓库基础

- macOS 环境（Tauri 依赖 WebKit；Profile 切换语义紧贴 macOS 文件系统）
- 包管理器 / 运行时 **统一用 Bun**（不要混 npm / pnpm / yarn）
- Rust ≥ 1.77（Tauri v2 后端）
- 改 `CLAUDE.md` / `AGENTS.md` 任一入口前同时审计另一份，保持规则语义一致

## 基础目录架构

创建或维护仓库时按这份结构落位；除非项目已有更强契约，不要为同类文件另建平行目录：

- `CLAUDE.md`：共享项目 SSOT（即本文件）。
- `AGENTS.md`：入口 / 工具机制差异，引用本文件的共享规则。
- `README.md`：面向用户的功能总览、启动方式、验证步骤和项目结构。
- `src/`：Bun/React 前端、CLI、profile 业务逻辑和工具配置读取器。
- `src-tauri/`：Tauri v2 Rust 后端；`src-tauri/target/` 是 Cargo/Tauri 标准产物目录，保持 git ignored。
- `scripts/`：项目脚本和自动化辅助脚本。
- `build/fe/`：前端 build 产物；项目根 `/build/` 保持 git ignored。
- `ref/changelogs/INDEX.md`：终态 changelog 索引；功能、行为、API、依赖或结构变化写 `ref/changelogs/CHANGELOG_X.md`。
- `ref/reviews/INDEX.md`：终态 review 索引；debug、性能、安全或 review-driven fix 写 `ref/reviews/REVIEW_X.md`。
- `ref/plans/INDEX.md`：终态 plan 索引；完成后的 plan 归档到 `ref/plans/`。
- `ref/conventions/INDEX.md`：已升级项目约定索引；约定正文用 `ref/conventions/<X>-<topic>.md`。
- `ref/conventions/tally.md`：重复用户反馈 / 重复 agent 踩坑计数入口。
- `.refs/`：必须加入 `.gitignore`；只放未终态 plan/review 工作副本，不放终态记录。

## 构建 & 本地安装

```bash
bunx tauri build --bundles app
cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/
```

---

## 改动后必做

### 1. 判断是否要更新 README.md

**README.md 是「功能总览」**：用户视角的能力清单。三问：

1. 新增 / 修改了**用户可见行为**？（CLI 子命令、UI 控件、配置项、symlink 切换语义、Hook 注入变量）→ 改对应章节
2. 改动了**文件结构 / 新建模块**？→ 改「项目结构」节
3. 改动了**启动方式 / 依赖 / 验证步骤**？→ 改「快速开始」节

纯 bug 修复 / 内部重构（不改用户感知）→ 不动 README，写到 `ref/changelogs/` 或 `ref/reviews/`。

### 2. 写 changelog 或 review（**必做，二选一**）

| 类型 | 写到 | 例子 |
|---|---|---|
| **功能变更**（新功能 / 行为修改 / API / 依赖升级） | `ref/changelogs/` | 新增 Profile 系统、删 env 模式、加 `dch profile env` |
| **Debug / 性能 / 安全 review**（不引入新功能，只修问题或加固） | `ref/reviews/` | TOCTOU / shell 注入 / hook 超时审查 |

**改任一 `ref/` 子目录都要同步该目录的 `INDEX.md`**（简表：`文件名 | 一句话概要`）。

#### `ref/changelogs/` 规则

- 文件名 `CHANGELOG_X.md`，X 递增整数。新建前 `ls ref/changelogs/` 找最大 X
- **小改动**（一两个文件、几十行同主题）→ 追加到最新 `CHANGELOG_X.md`；**大改动**（多模块 / 上百行 / 新功能）→ 新建 `CHANGELOG_X+1.md`
- 单文件结构：标题 + 概要（2-3 行）+ 变更内容（按模块 bullet）。**不要写「踩坑细节 / 推演过程」**——那些去 `ref/reviews/`

#### `ref/reviews/` 规则

- 文件名 `REVIEW_X.md`，X 递增整数。新建前 `ls ref/reviews/` 找最大 X
- 单文件结构：触发场景 + 方法（双对抗 Agent / 范围 / 工具）+ 三态裁决清单 + 修复条目

### 3. Plan / review 文档生命周期

- 未终态 plan / review 工作副本放当前环境工作区；无更强契约时用 `<repo>/.refs/plans/<plan-id>.md` / `<repo>/.refs/reviews/<review-id>.md`。
- 到终态后归档：plan 连同专属支持材料进 `ref/plans/`，review 进 `ref/reviews/REVIEW_X.md`；同步 INDEX，清理工作区副本。终态记录不要只留在 `.refs/`。

### 4. 改功能前先读历史记录

修改任何模块前，**先 `ls ref/changelogs/ ref/conventions/ ref/reviews/ ref/plans/` + 浏览相关条目**，了解已记录的设计决策、项目约定、plan 和 review 结论。

---

## 项目特定约定（设计要点速查）

反复出现过的设计决定，改动前注意：

### Bun first，禁止引 Node 同义工具

`tsconfig.json` 已经把类型与运行时锚定到 Bun。所有等价工具一律走 Bun 内置：

- 用 `bun <file>` 而不是 `node <file>` / `ts-node <file>`
- 用 `bun test` 而不是 `jest` / `vitest`
- 用 `bun build <file.html|file.ts|file.css>` 而不是 `webpack` / `esbuild`
- 用 `bun install` / `bun run <script>` / `bunx <pkg>`，不要混 npm / pnpm / yarn
- Bun 自动加载 `.env`，**不要引 dotenv**
- HTTP 用 `Bun.serve()`（带 WebSocket / HTTPS / routes），不要引 express
- SQLite 用 `bun:sqlite`，不要引 better-sqlite3
- 文件 IO 优先 `Bun.file`，子进程优先 `Bun.$`，不要引 execa

前端走 Bun 的 HTML imports + 内置 bundler（自动支持 React / CSS / Tailwind），不要引 vite。

### Profile 系统：symlink 是唯一切换通道

- `~/.claude` / `~/.codex` 永远是 symlink，指向某个 `<configDir>`。`dch profile use <id>` 通过「先 `ln -s` 临时名，再 `mv` 覆盖」做原子替换
- 第一次切换前必须跑 `dch profile init <tool>`：把现有真实目录 mv 到 `~/.<tool>-default`，再 ln -s 回去并注册成 default profile
- **禁止 env 切换模式**：Profile 切换只允许 symlink / junction。不要新增“不切 symlink、只写 user-level `settings.json` env”的路径；该路径会污染所有 cwd，且 Codex 没有同等机制（CHANGELOG_3）。
- 切换语义按 4 步走：① 跑 `preSwitch` hook（含 profile.env），失败则中断且不更新 active；② 原子 swap symlink；③ 写回 `~/.dch/profiles.json` 的 `active.<tool>`；④ 跑 `postSwitch` hook，失败仅警告

### `profile.env` 双注入路径

`profile.env` 默认只在 `preSwitch` / `postSwitch` 脚本里可见（用于 hook 内 curl 走代理等）。要让 env 也注入到 claude / codex 进程本身（OAuth 登录 / API 调用走代理）：

- 推荐：`dch profile env <tool>` 输出 shell-eval 格式 + `~/.zshrc` 加子 shell wrapper（CHANGELOG_4）
- 也可：把 env 写到 `<configDir>/settings.json` 的 `env` 块（**仅 claude code 支持**，codex 没有此机制）

`dch profile env` 的输出格式严格校验：key 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，value 单引号包裹做转义，**杜绝 shell 注入**——wrapper 会直接 `eval` 该输出，任何漏校验都是注入入口（CHANGELOG_4）。active 为空 / env 空时静默无输出，让 wrapper 自然 fall-through 到原命令。

### Hook 注入的环境变量（契约不变）

执行 `preSwitch` / `postSwitch` 脚本时注入：

```
DCH_PROFILE_ID         切到的 profile id
DCH_PROFILE_TOOL       claude | codex
DCH_PROFILE_CONFIG_DIR 该 profile 的绝对路径
DCH_SWITCH_TO          目标 profile id（同 DCH_PROFILE_ID）
DCH_SWITCH_FROM        先前 active profile id（首次 init 后可能为空）
```

变量名是对外契约，不要在脚本里硬编码绝对路径。`preSwitch` 退出码非零 → 中断切换，不更新 active 状态、不跑 postSwitch。

### Tauri / 前端边界

- 前端在 `src/client/`，通过 `bridge.ts` 调用 Tauri command；后端入口 `src-tauri/src/lib.rs` 只做 Tauri Builder 与 command 注册，具体 IPC 实现在 `src-tauri/src/commands/`。
- **CLI 是单一入口**：UI 的所有 profile 操作都通过 `run_dch_command` 调 cli 子命令，不要在 Rust 端复刻一份 profile 逻辑（避免 UI / CLI 行为分叉）
- **不要用 `window.confirm`**：Tauri 2 的 webview 不弹原生 confirm，所有确认必须改成内联 UI 状态（CHANGELOG_5）
- 前端表单一次填齐 preHook / postHook + 模型配置，不要分多步引导（CHANGELOG_5）

### 配置文件展示与编辑

工具配置文件（`~/.claude/settings.json` / `~/.codex/config.toml` / `~/.zshrc` 等）在 ConfigPanel 里只有三种 mode：

- **view**（默认，markdown 文件除外）：CodeMirror 6 只读 + 语法高亮
- **edit**：CodeMirror 6 可写 + 保存（带 TOCTOU 外部修改检测）
- **render**（仅 markdown 文件，如 `CLAUDE.md`）：react-markdown + GFM + shiki 代码块

**不要重新引入「列表」/「schema-driven 行内编辑」/「字段控件」**——schema 系统已整体删除（CHANGELOG_14）。唯一保留的 schema 残余是 `~/.dch/profiles.json` 编辑 modal（`ProfileStoreEditor`）的 lint：`src/schemas/dch-store.ts` + `editor/schema-lint.ts` 走 codemirror-json-schema。这是 dch 内部约束，跟工具配置 schema 无关。

### 单文件 ≤ 500 行

- 代码文件**含注释 / 空行不超过 500 行**。超过后下一次改动必须先拆分 / 重构再加新逻辑（按职责拆 / pure 逻辑 vs IO 分层 / 一个 component 一个文件）
- **例外**：测试文件、单份 changelog / review 可放宽到 ≤ 800 行；超 800 也要考虑按主题拆
- 新文件创建时 first commit 就要保持 ≤ 500，宁可一开始就拆，也不要先怼到一份再后期拆

---

## 反复反馈 / 反复踩坑 → 升级约定（自维护机制）

候选放 `ref/conventions/tally.md`，count ≥ 3 升级到 `ref/conventions/<X>-<topic>.md` 并同步 `ref/conventions/INDEX.md`。

| 类型 | 触发条件 |
|---|---|
| **用户反馈** (`# 用户反馈候选`) | 用户给「纠正性 / 偏好性」反馈：「不要…」「应该…」「以后…」「记住…」「每次…」 |
| **Agent 踩坑** (`# Agent 踩坑候选`) | Coding Agent 在 review / 修 bug 时**自己**发现踩了同类坑（典型：未走 symlink 路径校验、shell 注入、Tauri 2 弹原生 confirm） |

count = 3 → 走「双对抗三态裁决」评审升级提案后写入；count < 3 → 静默更新 tally。30 天未更新且 count < 3 → 下次扫描可清理。

> `ref/conventions/tally.md` 是项目记录，由 agent 维护。不要手工删条目。

---

## Review 过期与最小复审范围

准备下一次 review 时按本节确定最小复审范围；`ref/reviews/` 是会过期的覆盖记录，不是永久豁免。

下一次 review 的最小范围：

```text
unreviewed files ∪ expired reviewed files ∪ scope_unknown files
```

自最近一次覆盖该文件的 REVIEW 基线以来，满足任一条件即过期：

- 净改动 ≥ `min(200 行, 当前 LOC 的 30%)`。
- 不同 commit 数 ≥ 3。
- 距今 ≥ 90 天且文件至少改过一次。
- REVIEW frontmatter 标记 `expired: true`。

准备 review 时在仓库根目录运行 `bash scripts/file-level-review-expiry.sh`；脚本缺失时按上述条件用 `git log` 手工判定。

---

## 验证流程

```bash
# 单测
bun test

# 端到端冒烟
bun install
bun run dev                                      # Tauri 桌面窗口 + HMR
bun run cli                                      # CLI 总览

# Profile 链路冒烟（首次必须 init）
bun run cli profile init claude                  # 把 ~/.claude 转成 symlink + 建立 default
bun run cli profile add claude claude-test --dir ~/.claude-test --desc "smoke"
bun run cli profile use claude-test              # 切换 + 跑 hook
bun run cli profile current claude               # 应该输出 claude-test
bun run cli profile use claude-default           # 切回
bun run cli profile remove claude-test --yes
```

修改 `src-tauri/**` 后必须重新 `bun run dev`（Rust 后端要重编）；只改前端走 HMR 自动推送。
