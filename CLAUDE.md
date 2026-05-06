# CLAUDE.md

> 给 Claude Code 在本仓库工作时的硬性约定。本文件聚焦 **Dev Config Hub 专属** 的设计要点与改动流程；通用工程约定（输出语言、外部 CLI 调用、双 Agent 对抗审视等）由调用方自行约束，不在此重复。

## 仓库基础

- macOS 环境（Tauri 依赖 WebKit；Profile 切换语义紧贴 macOS 文件系统）
- 包管理器 / 运行时 **统一用 Bun**（不要混 npm / pnpm / yarn）
- Rust ≥ 1.77（Tauri v2 后端）

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

纯 bug 修复 / 内部重构（不改用户感知）→ 不动 README，写到 `changelog/` 或 `reviews/`。

### 2. 写 changelog 或 review（**必做，二选一**）

| 类型 | 写到 | 例子 |
|---|---|---|
| **功能变更**（新功能 / 行为修改 / API / 依赖升级） | `changelog/` | 新增 Profile 系统、删 env 模式、加 `dch profile env` |
| **Debug / 性能 / 安全 review**（不引入新功能，只修问题或加固） | `reviews/` | TOCTOU / shell 注入 / hook 超时审查 |

#### `changelog/` 规则

- 文件名 `CHANGELOG_X.md`，X 递增整数。新建前 `ls changelog/` 找最大 X
- **小改动**（一两个文件、几十行同主题）→ 追加到最新 `CHANGELOG_X.md`
- **大改动**（多模块 / 上百行 / 新功能）→ 新建 `CHANGELOG_X+1.md`
- 每次改 `changelog/` 都要同步 `changelog/INDEX.md`（简表：`[CHANGELOG_X.md](CHANGELOG_X.md) | 一句话概要`）
- 单文件结构：标题 + 概要（2-3 行）+ 变更内容（按模块 bullet）。**不要写「踩坑细节 / 推演过程」**——那些去 `reviews/`

#### `reviews/` 规则

- 文件名 `REVIEW_X.md`，X 递增整数。新建前 `ls reviews/` 找最大 X
- 每份 review 单文件结构：触发场景 + 方法（双对抗 Agent / 范围 / 工具）+ 三态裁决清单 + 修复条目
- 同步更新 `reviews/INDEX.md`

### 3. 改功能前先读 changelog

修改任何模块前，**先 `ls changelog/` + 浏览相关条目**，了解历史决策、避免推翻已有约定。比如「为什么删除了 env 切换模式只留 symlink」、「为什么 profile.env 不再写到 user-level settings.json」这类设计取舍都在 changelog 里有迹可循。

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
- **不再支持 env 切换模式**：历史上有 env-only 模式（不动 symlink，只把 env 写到 user-level `settings.json`），但会泄漏到所有 cwd，且 codex 没有对应机制，已统一删除（CHANGELOG_3）
- 切换语义按 4 步走：① 跑 `preSwitch` hook（含 profile.env），失败则中断且不更新 active；② 原子 swap symlink；③ 写回 `~/.dch/profiles.json` 的 `active.<tool>`；④ 跑 `postSwitch` hook，失败仅警告

### `profile.env` 双注入路径

`profile.env` 默认只在 `preSwitch` / `postSwitch` 脚本里可见（用于 hook 内 curl 走代理等）。要让 env 也注入到 claude / codex 进程本身（OAuth 登录 / API 调用走代理）：

- 推荐：`dch profile env <tool>` 输出 shell-eval 格式 + `~/.zshrc` 加子 shell wrapper（CHANGELOG_4）
- 也可：把 env 写到 `<configDir>/settings.json` 的 `env` 块（**仅 claude code 支持**，codex 没有此机制）

`dch profile env` 的输出格式严格校验：key 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，value 单引号包裹做转义，**杜绝 shell 注入**。active 为空 / env 空时静默无输出，让 wrapper 自然 fall-through 到原命令。

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

- 前端在 `src/client/`，通过 `bridge.ts` 调用 Tauri command；后端在 `src-tauri/src/lib.rs`，主要做文件读写 / 版本检测 / `run_dch_command`（spawn cli）
- **CLI 是单一入口**：UI 的所有 profile 操作都通过 `run_dch_command` 调 cli 子命令，不要在 Rust 端复刻一份 profile 逻辑（避免 UI / CLI 行为分叉）
- **不要用 `window.confirm`**：Tauri 2 的 webview 不弹原生 confirm，所有确认必须改成内联 UI 状态（CHANGELOG_5）
- 前端表单一次填齐 preHook / postHook + 模型配置，不要分多步引导（CHANGELOG_5）

### 配置描述来源

UI 展示的配置项描述全部来自各工具的官方文档 / Schema，**不允许自行揣测**：

- Claude Code: `https://json.schemastore.org/claude-code-settings.json`
- Codex CLI: 官方 config-reference 文档
- OpenCode: 官方 config docs
- Shell（zprofile / zshrc）: 不做语法解析，直接展示原文

新增工具支持时，按这个原则给 `descriptions.ts` 喂数据。

### Schema 系统硬约束（PR-D 升级，schema-driven 行内编辑生效后）

`src/schemas/` 是 schema-driven UI 的真理来源，三条铁律不可破：

1. **行内编辑必须走 `src/schemas/` 的 `FieldSchema`**，禁止控件层（`src/client/components/fields/*`）自创类型 / 字段语义。所有 enum / range / pattern / sensitive / default 都必须从 schema 读，不准在控件里硬编码
2. **schema 字段必须带 `// source:` 注释**绑约束（enum 值 / default / min/max / type）。来源记在每份 schema 文件的 `$source: <上游 URL>`；上游漂移走 `bun src/schemas/sync.ts --fetch <scope>` 拉 diff 后人工对照修改。**严禁揣测字段语义**（REVIEW_3 R_1·C1/C2/C3 教训：手工翻译漏档 / default 反转 / max 揣测都被对抗 review 实证抓住）
3. **写回必须基于「原文 + 字段级 patch」**（`patchJson` 走 `jsonc-parser` modify + applyEdits / `patchToml` 行级 in-place + fallback 重新 stringify），**禁止「全量序列化 `parsed`」**。这是「schema 不认识的用户自定义 key 永远不丢」的根本保障 —— `additionalProperties: true` + 字段级 patch 的双重防护。`SchemaScopeBody` 用 `diffPatches(old, new)` 算最小 patch 集合后再走 patcher，绝不全量重写

**CI 门禁**：`bun src/schemas/sync.ts --check-self` 校验所有 schema 自洽（ajv compile），schema 写错立刻 fail。建议接到 git hook 或 CI 流水线。

### 单文件 ≤ 500 行

- 一般代码文件**含注释 / 空行不超过 500 行**。超过后下一次改动必须先拆分 / 重构再加新逻辑（按职责拆 / pure 逻辑 vs IO 分层 / 一个 component 一个文件）
- **例外**：测试文件、数据字典（如 schema 字段定义、`descriptions.ts`）、单份 changelog / review 可放宽到 ≤ 800 行；超 800 也要考虑按主题拆
- 现存超标已知（不重构不让新加）：`ProfilePanel.tsx` ~1000 行（已规划 PR-I 拆 7 文件）；`bridge.ts` 接近上限待观察
- 新文件创建时 first commit 就要保持 ≤ 500，宁可一开始就拆，也不要先怼到一份再后期拆

---

## 反复反馈 / 反复踩坑 → 升级约定（自维护机制）

候选放 `.claude/conventions-tally.md`，count ≥ 3 升级到本文件「项目特定约定」。

| 类型 | 触发条件 |
|---|---|
| **用户反馈** (`# 用户反馈候选`) | 用户给「纠正性 / 偏好性」反馈：「不要…」「应该…」「以后…」「记住…」「每次…」 |
| **Agent 踩坑** (`# Agent 踩坑候选`) | Coding Agent 在 review / 修 bug 时**自己**发现踩了同类坑（典型：未走 symlink 路径校验、shell 注入、Tauri 2 弹原生 confirm） |

count = 3 → 走「双对抗三态裁决」评审升级提案后写入；count < 3 → 静默更新 tally。30 天未更新且 count < 3 → 下次扫描可清理。

> tally 是 Claude Code 内部状态，**不要手工管理**。

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

## 已踩的坑（别再回退）

每条都有对应 changelog：

- **不要再加 env 切换模式**：曾经支持过「不切 symlink、只把 env 写到 user-level `settings.json`」，结果污染所有 cwd 而且 codex 没对应机制，CHANGELOG_3 已删干净
- **`dch profile env` 必须严格校验 key/value**：CHANGELOG_4 的 wrapper 直接 `eval` 输出，任何漏校验都是 shell 注入入口
- **UI 不要弹 `window.confirm`**：Tauri 2 webview 不支持，会卡死操作（CHANGELOG_5）
- **新建 profile 表单一次填齐**：preHook / postHook / 模型配置一并采集，不要分步引导（CHANGELOG_5）
