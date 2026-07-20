---
review_id: 4
reviewed_at: 2026-05-06
expired: false
skipped_expired: []
---

# REVIEW_4: CHANGELOG_8 全量收口（PR-D/E/G/H/I/J + Follow-up #1-4）

## 触发场景

CHANGELOG_8「Schema-driven 精细化配置 + Markdown 渲染 + JSON 高亮」剩余 6 个 PR（PR-D 接入 Claude settings.json schema → PR-E TOML / OpenCode / .mcp.json → PR-G CM6 edit + JSON Schema lint+hover+completion → PR-H Markdown 渲染 → PR-I ProfilePanel 拆 7 文件 + dch-store schema → PR-J sync.ts CI 自动化 + ajv runtime 校验 + bundle splitting）+ 4 个 follow-up（#1 PathField Tauri dialog / #2 happy-dom 单测 / #3 字段 errors Context / #4 schema-sync GitHub Action）落盘前的最终质量闸门。覆盖 ~3000+ 行新代码 / 30+ 文件，是 10 PR 路线图的最后一公里——错过这里就要等下一次大重构 review。

## 方法

**双对抗配对**（同 REVIEW_3，见 `~/.claude/CLAUDE.md`「决策对抗」节 + `agent-deck:deep-code-review` skill）：

- **reviewer-claude**（Opus 4.7 xhigh）：teammate 模式，跨轮 context 持久化
- **reviewer-codex**（gpt-5.5 xhigh wrapper，Bash 调外部 codex CLI `model_reasoning_effort=xhigh`）：teammate 模式

**轮次**：

- **Round 1**（修复正确性 / 是否引新问题 / 测试质量 / 安全 / 数据完整性）：双 reviewer 同时给完整 finding；reviewer-claude 8 候选（含 H1+H1' / H2 / H3）+ reviewer-codex 多 finding。lead 综合后裁决 5 HIGH + 11 MED + 7 LOW + 多 ❌ 反驳
- **Round 2**（fix 验证 + 边界 / 并发 race / 资源 lifecycle / 性能尾延迟 / IME / sanitize 复审）：双 reviewer sendMessage 复用 R_1 context；reviewer-claude 2 HIGH（R-H1 R-H2）+ 5 MED（R-M1..M5）+ 2 LOW（R-L1 R-L2）+ 4 ❌ + 3 ❓ + 3 AP 候选；reviewer-codex 多条边界 finding 已在 R_1 fix 链路被直接处置

**范围**：30+ 文件 / ~3000 行（schemas/ 全套 + client/components/{fields,editor,markdown,profile,schema-mode}/ 全套 + lib.rs 增 88 行 + bridge.ts 增 47 行 + ConfigPanel.tsx 增 150 行 + ProfilePanel.tsx 净减 578 行 + styles.css 增 190 行 + sync.ts CI 自动化 + GitHub Action）

```text
PR-D Claude settings.json 完整化 + Schema mode（10+ 文件）
PR-E Codex / OpenCode / .mcp.json + toml-patcher（3 schema + patcher + 11 case）
PR-G CM6 edit + JSON Schema lint/hover/completion + TOCTOU 完整 banner
PR-H Markdown 渲染（react-markdown + shiki + GFM + sanitize + 8 case）
PR-I ProfilePanel 拆 7 文件（789→261）+ dch-store schema + ProfileStoreEditor
PR-J sync.ts list/--check-self/--fetch/--list-scopes + ajv runtime + bundle splitting
Follow-up #1 PathField Tauri dialog（plugin-dialog v2）
Follow-up #2 CMEditor / MarkdownView happy-dom 单测（+16 case）
Follow-up #3 FieldErrorsProvider Context 按 path 分发 errors
Follow-up #4 .github/workflows/schema-sync.yml weekly cron + auto-issue
```

**机器可读范围**（File-level Review Expiry 用；一行一个仓库相对路径，按字典序、去重；禁止目录 / glob / brace expansion）：

```review-scope
.github/workflows/schema-sync.yml
src-tauri/Cargo.toml
src-tauri/src/lib.rs
src/cli-profile.ts
src/client/App.tsx
src/client/bridge.ts
src/client/components/ConfigPanel.tsx
src/client/components/ProfilePanel.tsx
src/client/components/editor/CMEditor.test.tsx
src/client/components/editor/CMEditor.tsx
src/client/components/editor/languages.ts
src/client/components/editor/schema-lint.ts
src/client/components/editor/theme.ts
src/client/components/fields/ArrayField.tsx
src/client/components/fields/BooleanField.tsx
src/client/components/fields/CodeField.tsx
src/client/components/fields/EnumField.tsx
src/client/components/fields/FieldRow.tsx
src/client/components/fields/KVMapField.tsx
src/client/components/fields/MarkdownField.tsx
src/client/components/fields/NumberField.tsx
src/client/components/fields/ObjectField.tsx
src/client/components/fields/PathField.tsx
src/client/components/fields/SensitiveField.tsx
src/client/components/fields/StringField.tsx
src/client/components/fields/UnknownField.tsx
src/client/components/fields/errors-context.tsx
src/client/components/fields/index.tsx
src/client/components/fields/types.ts
src/client/components/markdown/MarkdownView.test.tsx
src/client/components/markdown/MarkdownView.tsx
src/client/components/markdown/highlighter.ts
src/client/components/profile/AddProfileModal.tsx
src/client/components/profile/HookOutputModal.tsx
src/client/components/profile/PreferencesEditor.tsx
src/client/components/profile/ProfileCard.tsx
src/client/components/profile/ProfileStoreEditor.tsx
src/client/components/profile/helpers.ts
src/client/components/schema-mode/SchemaScopeBody.tsx
src/client/styles.css
src/schemas/claude-mcp.ts
src/schemas/codex-config.ts
src/schemas/dch-store.ts
src/schemas/diff.ts
src/schemas/opencode-config.ts
src/schemas/sync.ts
src/schemas/to-json-schema.test.ts
src/schemas/to-json-schema.ts
src/schemas/toml-patcher.test.ts
src/schemas/toml-patcher.ts
src/schemas/validator.test.ts
src/schemas/validator.ts
src/types.ts
test-setup.ts
```

> REVIEW_3 已审范围（`src/schemas/{types,helpers,registry,claude-settings,index}.ts` + REVIEW_3 时已经 ship 的 PR-A/PR-B/PR-F 文件如 `json-patcher.ts` / `CMEditor.tsx` / `bridge.ts` / `lib.rs`）本轮按「过期复审」处理：净 churn 大 / commit ≥ 3 / 距覆盖基线极短但被本轮新接入 caller 大幅扩展，所以 `bridge.ts` / `lib.rs` / `CMEditor.tsx` / `claude-settings.ts` 仍纳入。仅 `helpers.ts` / `registry.ts` / `types.ts` / `index.ts` / `json-patcher.ts` 因 REVIEW_3 后无功能变更跳过。

**约束**：deep-code-review skill 默认（teammate 模式 + 跨轮 sendMessage 复用 context + 反驳轮针对单方独有 HIGH + 三态裁决「不接受没验证的 ✅ HIGH」）。

## 三态裁决结果

> 本节遵循全局「决策对抗」节的验证纪律：每条 ✅ 必须带**验证手段**（grep / 写小 test / 跑命令 / 读真实代码 / WebFetch 上游 schema），未验证的 finding 强制降级 ❓ + 非 HIGH。弱断言关键词只允许出现在 *未验证* 条目里。

### ✅ 真问题（双方独立提出 / 一方提出且现场实践验证成立）

#### Round 1 — 5 HIGH + 11 MED + 7 LOW（共 23 条）

| # | 严重度 | 文件:行号 | 问题 | A (claude) | B (codex) | 验证手段 |
|---|---|---|---|---|---|---|
| H1 | HIGH | `SchemaScopeBody.tsx:160` `onConflictReload` | 硬编 `JSON.parse(conflict.freshContent)` → TOML scope（codex / opencode）必 throw → catch 块 `setParsed({})` 让 codex config 整面板瞬变空 + banner 消失，用户感知「外部修改了文件」+ 「我点重载」+ 「面板空了」三连惊吓 | HIGH | — | claude bun repro：parseToml + fallback 路径走通 / 验证 setParsed({}) 路径触发 |
| H1' | HIGH | `claude-settings.ts:52` `defaultMode` enum | 仅列 `acceptEdits` / `plan` / `bypassPermissions` 3 项，**漏 `default` / `auto` / `dontAsk` / `ask`** —— 上游真实 7 项（与 reviewer-claude WebFetch schemastore 对比） | HIGH | — | WebFetch `https://json.schemastore.org/claude-code-settings.json` 拿到上游 enum |
| H2 | HIGH | `dch-store.ts:32` `profile.id` pattern | `^[\w-]+$` 与 `src/profiles/manager.ts` ID_RE `^[a-zA-Z0-9_-]+$` 不一致：schema 接受 `_` / 中文 / 全角等；CLI 拒。schema 校验通过但保存时 CLI 报错 | HIGH | — | claude grep manager.ts ID_RE 比对 |
| H2' | HIGH（**R_2 R-H2 反驳后回退**） | `to-json-schema.ts:108` `kv-map` case | 之前 `additionalProperties: keyPattern ? false : valueSchema` 严格化 → 与上游 schema（`patternProperties + additionalProperties: valueSchema`）不一致 → 合法 `env: { http_proxy: "x" }` 在 R_1 fix 后被 ajv 拒（lowercase env 真实存在） | HIGH（提出严格化） | R_2 R-H2 反驳 | R_2 reviewer-claude WebFetch 上游 schemastore 实证 env 用 patternProperties + additionalProperties: { type: "string" } |
| H3 | HIGH | `CMEditor.tsx:49` `extraExtensions: Extension[]` | 类型 `Extension[]` 不接受 `readonly Extension[]`；caller `EMPTY_EXTRA` 是 `as const readonly []` → tsc 报错。bun 宽容编译过了但严格 `tsc` 挂 | HIGH | — | claude bun + tsc 实证 |
| M1 | MED | `SchemaScopeBody.tsx:106` `doSave` catch | 之前 `catch` 仅静默回滚 `setParsed(oldParsed)` → 用户改字段后保存失败完全不感知（看到「值变回去了」想「我手抖了」） | MED | — | 静态阅读 + 对照 REVIEW_2 PR-4 H2 同类教训 |
| M2 | MED | `ConfigPanel.tsx` schema mode 切换 | 之前 `defaultModeFor` 仅按 ScopeKind 决定默认；用户切到 raw 编辑后再切回 schema mode 自动跳回，丢失「我刚才主动选 raw」的语义 | MED | — | 静态阅读 |
| M3 | MED | `validator.ts:12` ajv 实例 | 之前每次 validate 全局 new Ajv → ajv schema cache miss / 重复 compile。改用 `WeakMap<ToolSchema, Ajv>`，每个 ToolSchema 一个 Ajv 实例，跨调用 cache 命中（性能 + 行为正确性双收）| MED | — | claude WebFetch ajv 文档 + 推演 |
| M4 | MED | `to-json-schema.ts` field 转换 | enum 短形式（`enum: ["a", "b"]`）转出 `{ enum: ["a", "b"] }` 不带 `type: "string"` → ajv 默认 inferred but for type-check 严格模式漏报 typo（`enum: 42` 不报错） | MED | — | claude bun ajv strict mode repro |
| M5 | MED | `dch-store.ts` hookTimeoutMs 三方对齐 | schema `min:1000 max:600000` / cli-profile.ts cmdConfig 校验 / `PreferencesEditor.tsx` UI 三处 magic number；改一处忘改另两处 | MED | — | grep 3 处常量 |
| M6 | MED | `validator.ts:54` Diagnostic.path | 之前 `path = dotted \|\| "<root>"` → FieldRow `useFieldErrors("")` 永远 miss 根错误（root path 常空字符串） | MED | — | claude bun repro 根字段错 |
| M7 | MED | `PathField.tsx:94` `onPick` catch | 之前 dialog 失败仅 `console.warn` → 生产环境用户点 📁 没反应，怀疑 app 卡死。改 `setPickError` inline 显示 | MED | — | 模拟 dialog throw |
| M8 | MED | `PathField.tsx` 起始路径 | dialog `defaultPath` 之前不设 → 每次都从 home 开。用 `scopeContext.filePath` 的目录做起始（如编辑 `~/.claude/settings.json` 选目录默认从 `~/.claude/` 开始） | MED | — | UX 优化 |
| M9 | MED | `claude-mcp.ts` mcpServers `command` enum | 之前 enum 列了 stdio / sse / http 但实际官方 schema 是 `type: enum`（不是结构判别）—— 对 type 字段加 enum，对 cmd / url 字段独立 string | MED | — | WebFetch claude.ai mcp docs |
| M10 | MED | `sync.ts:134` `--list-scopes` | CI workflow 之前硬编 5 个 scope 名；scheme 增减时 yaml 不知道。新增 `--list-scopes` 让 GitHub Action 动态拿列表 | MED | — | YAML 改一处看一处 |
| M11 | MED | `App.tsx` onPatchSave | 之前 PR-D 走 onSave reload 全量 loadAllConfigs → 字段级 patch 后 UI 闪烁 / 滚动跳动。新增 onPatchSave 路径不 reload，乐观 setState | MED | — | 实测 UI 抖动 |
| L1 | LOW | `toml-patcher.ts:128` quoted key | quoted key 含点号（`"a.b" = 1`）与嵌套 section dotted key（`[s.a] b = 1`）边界 patcher 走 fallback；已知限制注释 | LOW | — | 静态阅读 |
| L2 | LOW | `MarkdownView.tsx:45` 注释 | 之前注释「rehype-sanitize 防 javascript: URL」实际防御靠 `defaultSchema.protocols.href` 白名单（http / https / mailto / tel），rehype-sanitize 删 `<script>` 标签是另一路。注释修正避免维护者按错路径调 | LOW | — | rehype-sanitize 文档 |
| L3 | LOW | `KVMapField.tsx:72` NEW_KEY 自增 | 之前 `++n` 先增后用 → 第一个新 key 永远是 `NEW_KEY_2`（用户预期 `NEW_KEY_1`） | LOW | — | claude bun ++ vs n++ 复演 |
| L4 | LOW | `dch-store.ts:55` env keyPattern | 与 `manager.ts` ENV_KEY_RE 不一致（混合大小写 vs 全大写） | LOW | — | grep |
| L5 | LOW | `toml-patcher.ts:177` 死分支 | 之前 `Number.isInteger(v) ? String(v) : String(v)` —— 三元两支同结果 | LOW | — | 静态阅读 |
| L6 | LOW | `claude-settings.ts:121` effortLevel description | 「Opus 4.6 自适应推理深度」→ effortLevel 实际 Opus 4.7+ 才有，4.6 用 fastMode，描述事实错 | LOW | — | WebFetch 上游 docs（R_2 R-L2 进一步精修） |
| L7 | LOW | `highlighter.ts:47` shiki BundledLanguage | 之前 `lang as BundledLanguage` 强转 + `@vite-ignore` 注释 → 接受任意 string 不在 union 里时 shiki 内部 throw。删强转改用 dynamic getHighlighter 接受 string + try/catch | LOW | — | 静态阅读 + shiki 文档 |

#### Round 2 — 2 HIGH + 5 MED + 2 LOW（共 9 条新）

| # | 严重度 | 文件:行号 | 问题 | A (claude) | B (codex) | 验证手段 |
|---|---|---|---|---|---|---|
| R-H1 | HIGH | `PathField.tsx` 之前 `process.env.HOME` | Tauri WKWebView 无 `process` 全局；bun bundler **inline** `process.env.HOME` 时把开发机路径写进 bundle → 用户机器路径不对，`expandHome` 不生效 + 信息泄漏。改用 Tauri `getHomeDir` async IPC | R-H1 HIGH | — | claude WebSearch Tauri webview process global + bun docs inline 行为 |
| R-H2 | HIGH | `to-json-schema.ts:108` kv-map | R_1 H2' 严格化（`additionalProperties: false`）后 ajv 拒合法 lowercase env（`http_proxy` / `with-dash`）→ 与上游 Claude Code env 行为不一致（上游用 `patternProperties + additionalProperties: { type: string }`，keyPattern 仅 hint，UI 红框守门）→ 严校验比上游严反而是回归 | R-H2 HIGH | — | claude WebFetch schemastore claude-code-settings.json env definition |
| R-M1 | MED | `PathField.tsx:35` openDialog unmount race | `await openDialog(...)` 期间组件可能 unmount；React 19 移除 unmount setState warning，没了 console 噪音提醒 → 静默幽灵 onChange 改盘。`mountedRef.current` 守门 | R-M1 MED | — | claude 静态推演 + React 19 changelog |
| R-M2 | MED | `PreferencesEditor.tsx:12` uncontrolled | 之前 `<input defaultValue={store.preferences.hookTimeoutMs}>` uncontrolled + onBlur 校验失败 input.value 不还原 → UI 显「50」（用户输的非法值）但 store 仍 30000，脱节。改 controlled `draftMs` state + 失败还原 | R-M2 MED | — | 静态阅读 + UX 推演 |
| R-M3 | MED | `SchemaScopeBody.tsx:59` saving 期间 reload | useEffect deps 含 `scope.parsed` / `scope.content` → 若 saving 中外部 reload 触发 setState `scope.parsed` → useEffect 跑 → setParsed(scope.parsed) 覆盖 in-flight 乐观更新中的 newParsed → 用户改动丢失 | R-M3 MED | — | claude 静态推演 + 加 `if (saving) return;` guard |
| R-M4 | MED | `CMEditor.tsx:177` extraExtensions Compartment reconfigure | R_1 L4 fix 用 `isFirstExtraEffect` ref guard 跳过初次 noop reconfigure；但 useRef 跨 unmount 持久（Strict Mode 双 mount → 第二次 mount 时 ref 已是 false → 第一次真正 reconfigure 错跳） | R-M4 MED | — | claude 推演 React 19 Strict Mode useRef 行为 + 删 ref 接受 1ms noop dispatch（简化） |
| R-M5 | MED | `to-json-schema.test.ts` + `validator.test.ts` | R-H2 fix 后两份测试需对齐（一个测「lowercase env 不报错」/ 一个测「kv-map 转 patternProperties + additionalProperties: valueSchema」）| R-M5 MED | — | bun test 209 → 209 |
| R-L1 | LOW | `SchemaScopeBody.tsx:175` setLoadedMtimeUs | `conflict.freshMtimeUs` 可能 null（pre-1970 / FS 不支持 mtime）→ setLoadedMtimeUs(null) 后下一轮 save 跳 stat 比对 → fallback 应重新 readFileWithMtime 拿新值 | R-L1 LOW | — | 静态阅读 + REVIEW_3 D2 三态语义对照 |
| R-L2 | LOW | `claude-settings.ts:121` effortLevel description | R_1 L6 改成「Opus 4.7 自适应推理深度（4.6/4.7 family 共用）」事实错——effortLevel 与 fastMode 是**互斥**的两个 family 特性（fastMode 仅 4.6 / effortLevel 仅 4.7+），非共用。改成「Opus 4.7+ 自适应推理深度（与 fastMode 互斥：fastMode 仅 Opus 4.6 / effortLevel 仅 Opus 4.7+）」 | R-L2 LOW | — | 静态阅读 + 与 fastMode 注释对照 |

### ❌ 反驳（被对抗或现场核实证伪）

| 报告方 | 报项 | 反驳依据（验证手段 + 结论） |
|---|---|---|
| R_1 codex | smol-toml 没有 stringify（toml-patcher fallback 路径会挂） | bun 实证 smol-toml 导出 stringify；fallback 路径走通 |
| R_1 codex | jsonc-parser modify 顶层 string-literal `'"hi"'` 静默 silent corruption | claude R_1 实测 throw（被外层 try/catch 截）；codex R_1 反驳轮报告 silent corruption（`{"a":1}hi`）。实际是 ESM/CJS 路径差异；保留 assertValidJsonOut 作回归网（REVIEW_3 D1 同一论证） |
| R_1 claude | TS draft 2020-12 schema URI ajv@8 不识别 | 实证 ajv@8 不识别；sync.ts checkSelf 删 $schema 后 compile（不是 fix 引入的回归，是 ajv 已知行为） |
| R_2 claude | CMEditor extraExtensions reconfigure 总产 noop transaction（性能 / 滚动跳动） | bun 实测 1ms noop dispatch 单帧无感（< 16ms）；删 ref guard 简化代码可接受 |
| R_2 双方一致 | dch-store profile.id pattern 改严会回归现网 store | grep 现网 store profile.id 全部匹配新 pattern（无 `_` / 中文）；H2 fix 安全 |
| R_2 codex | bundle splitting 后 lazy chunk cold load 慢 | 实测 entry 3.65 MB / 11 chunks；shiki / vitesse-light/dark / wasm 都是 lazy（首屏不加载）；cold load 实测 < 200ms M1 |
| R_2 codex | rehype-sanitize SAFE_SCHEMA 自定义可能漏 `data:image/svg+xml` SVG XSS | claude WebFetch hast-util-sanitize 文档：SAFE_SCHEMA 默认 `protocols.href` 白名单 http/https/mailto/tel，`data:` 不在内 → svg xss 阻断 |
| R_2 claude | shiki dynamic import 在 Tauri WKWebView CSP 下挂 | bun build 实测 dynamic import 走 ES module（webview file:// scheme 默认允许）；happy-dom 单测显示 fenced code 渲染降级 plain（shiki lazy 未就绪也不挂） |

### ❓ 部分 / 未验证（双方角度不同 / 一方提出但未实践验证）

| 现场 | 视角 | 是否已验证 | 结论 |
|---|---|---|---|
| ProfileStoreEditor 编辑 `~/.dch/profiles.json` 同时 CLI 跑 `dch profile use ...` 写盘 | R_2 claude 边界 | 未实测多端并发 | 推到下轮（建议借用 REVIEW_2 PR-5 O_EXCL 文件锁，UI 写也走 manager API 而非直 saveStore） |
| CodeMirror schema-lint 在嵌套 union schema 下 hover 描述准确度 | R_2 claude UX | 未实测复杂 schema | INFO，标 LOW，等真实复杂场景反馈 |
| Tauri WKWebView 在大文件（200 项 hooks / 100KB JSON raw view）下 CM6 滚动 fps | R_2 codex 性能 | 未实测大文件 | INFO，PR-J 性能 audit 留口子 |

## 修复（CHANGELOG_8 落地）

### HIGH（5 条全修，R_1 + R_2 共 7 候选 → R-H2 反驳 H2' / 其余 5 条全 fix）

1. **`SchemaScopeBody.tsx:160`** — onConflictReload 按 scope.format 分流 parser（H1）；R_2 M1 补 catch 后 `return` 保留 conflict banner
2. **`claude-settings.ts:52`** — defaultMode enum 补 `default` / `auto` / `dontAsk` / `ask` 至 7 项（H1'）
3. **`dch-store.ts:32`** — profile.id pattern 改 `^[a-zA-Z0-9_-]+$` 与 manager.ts ID_RE 对齐（H2）
4. **`to-json-schema.ts:108`** — kv-map 回退到 `patternProperties + additionalProperties: valueSchema`（与上游一致；H2' 严格化被 R_2 R-H2 反驳后回退）
5. **`CMEditor.tsx:49`** — extraExtensions 类型 `readonly Extension[]`（H3）
6. **`PathField.tsx`** — 删 `process.env.HOME`，改用 Tauri `getHomeDir` async IPC（R-H1）

### MED（11 + 5 共 16 条全修）

R_1：

1. **`SchemaScopeBody.tsx:107`** — doSave catch flash 错误提示（M1）
2. **`ConfigPanel.tsx`** — fallbackMode helper 记忆用户主动选择，不强切回 schema（M2）
3. **`validator.ts`** — `WeakMap<ToolSchema, Ajv>` 每 schema 独立 Ajv 实例 + cache（M3）
4. **`to-json-schema.ts`** — enum 短形式自动推断 `type: "string"`（M4）
5. **`dch-store.ts` + `cli-profile.ts:313` + `PreferencesEditor.tsx:17`** — hookTimeoutMs 三方常量对齐（M5）
6. **`validator.ts:54`** — Diagnostic.path 用 `""` 表 root（不再 `"<root>"`）让 useFieldErrors("") 命中（M6）
7. **`PathField.tsx:94`** — onPick catch setPickError inline 显示（M7）
8. **`PathField.tsx`** — dialog defaultPath 用 scopeContext.filePath 目录（M8）
9. **`claude-mcp.ts`** — mcpServers `type` enum + cmd / url 独立字段（M9）
10. **`sync.ts:134`** — 加 `--list-scopes` 让 CI YAML 动态拿（M10）
11. **`App.tsx` + `bridge.ts`** — onPatchSave 路径不 reload，乐观 setState（M11）

R_2：

12. **`PathField.tsx:35`** — mountedRef.current guard openDialog unmount race（R-M1）
13. **`PreferencesEditor.tsx:12`** — controlled `draftMs` state + 失败还原（R-M2）
14. **`SchemaScopeBody.tsx:59`** — useEffect 加 `if (saving) return;` 跳 saving 期间 reload 覆盖（R-M3）
15. **`CMEditor.tsx:177`** — 删 isFirstExtraEffect ref guard，接受 1ms noop dispatch（R-M4）
16. **`to-json-schema.test.ts` + `validator.test.ts`** — 对齐 R-H2 fix 后行为（R-M5）

### LOW（7 + 2 共 9 条全修）

R_1：

1. **`toml-patcher.ts:128`** — quoted key 含点号已知限制 JSDoc（L1）
2. **`MarkdownView.tsx:45`** — javascript: URL 防御注释指向 SAFE_SCHEMA.protocols.href（L2）
3. **`KVMapField.tsx:72`** — NEW_KEY 自增改 `n++` 后用让第一个 key 是 NEW_KEY_1（L3）
4. **`dch-store.ts:55`** — env keyPattern 与 manager.ts ENV_KEY_RE 同源（L4）
5. **`toml-patcher.ts:177`** — 删死分支三元（L5）
6. **`claude-settings.ts:121`** — effortLevel description 修事实（L6，R_2 R-L2 进一步精修措辞）
7. **`highlighter.ts:47`** — 删 BundledLanguage 强转 + `@vite-ignore` 注释（L7）

R_2：

8. **`SchemaScopeBody.tsx:175`** — freshMtimeUs null 时 fallback 重读 readFileWithMtime（R-L1）
9. **`claude-settings.ts:121`** — effortLevel description 改「Opus 4.7+ 自适应推理深度（与 fastMode 互斥：fastMode 仅 Opus 4.6 / effortLevel 仅 Opus 4.7+）」（R-L2）

### 验证

- `bun test`：207 → **209 pass / 0 fail / 0 回归**（+2 case：to-json-schema kv-map patternProperties + validator lowercase env 不报错）
- `bun run build:fe --splitting`：748 modules / entry 3.65 MB + 11 chunks（含 shiki vitesse-light/dark / oniguruma wasm 全部 lazy）
- `cargo check`：通过（含 tauri-plugin-dialog）
- 单文件大小全部 ≤ 500 行（最大 SchemaScopeBody 257 / CMEditor 179 / claude-settings ~190 / lib.rs 351）

## 关联 changelog

- [CHANGELOG_8.md](../../changelogs/history/CHANGELOG_8.md)：本次修复在「REVIEW_4 fix」节追加（分 R_1 / R_2 两段）

## Agent 踩坑沉淀

本次 review 当时提炼出 3 条 agent-pitfall 候选（原写入后来已移除的 `.claude/conventions-tally.md`）：

- **AP-8**：前端 / Tauri webview 禁用 `process.env.*`——webview 无 `process` 全局；bun bundler 默认 inline 让开发机路径 / 密钥写进 bundle。一律走 IPC 异步拿（R-H1）
- **AP-9**：「严校验比上游严」反而是回归——schema 校验严过上游会让真实合法值标红 / 拒收。施加任何「严过上游」的 pattern / enum / additionalProperties 之前必须 WebFetch 上游 schema 实证（R-H2）
- **AP-10**：React 19 移除 unmount setState warning，async await 期间 unmount 的 setState / 副作用 callback 不再有 console 提醒——`mountedRef` / cleanup flag 守门变成隐性必需（R-M1）

同主题再撞 2 次会触发升级到项目 CLAUDE.md「项目特定约定」节。
