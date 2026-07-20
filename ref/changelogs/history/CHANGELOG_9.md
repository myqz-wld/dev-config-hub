---
changelog_id: 9
changed_at: 2026-05-07
---

# CHANGELOG_9: 自定义 schema 本地 override + 字段隐藏 + schema 字段补全

## 概要

CHANGELOG_8（schema-driven 配置）实测一段时间后发现两个结构性问题：(1) 内置 schema 知识落后或误判时，用户没有本地 override 通道，只能等主线发新版（典型踩坑：`enabledPlugins` 误判成 `array of map` → Claude Code 报 "Expected record, but received array"）；(2) schema 字段越补越多，root level 列表噪音淹没常用字段。本次加两个 feature 一并解决：**用户可在 `~/.dch/schemas/` 放字段级 override JSON**；**root level 字段可在 UI 里隐藏**。同时顺手把官方 schema 里 dch 缺失的常见字段（Claude/Codex/OpenCode 共 ~32 个）补上、KV 类字段（hooks / pluginConfigs / enabledPlugins / extraKnownMarketplaces / mcp_servers / opencode provider/agent/tools/command/mcp）一律改 KV-map 渲染（之前是 ObjectField 渲染→挂一堆 unknown badge / [object Object]）。

## 变更内容

### `src/schemas/`（schema 系统）

- **新增 `custom-loader.ts`**：从 `~/.dch/schemas/<scopeKind>.json` 加载用户自定义 schema partial，与内置 ToolSchema 字段级合并
  - `loadCustomSchemas(home)` 走 Tauri readDir + read_file，文件 stem 必须是已知 ScopeKind；parse / shape 失败 → console.warn 跳过、不阻塞其他文件 / 不阻塞 app 启动
  - `mergeSchemas(builtin, override)` 实现合并语义：顶层 description / $source / fetchedAt override 优先；rootSchema.properties dict-level shallow merge（同 key 整体替换、不递归深合并）；propertyOrder override 在前 builtin 剩余追加；additionalProperties 强制 true；$id / scopeKind 不允许 override
  - 不修改 builtin 入参（产新对象，避免 ajv WeakMap 命中 stale validator）
- **`registry.ts` 改造**：BUILTIN_REGISTRY 不变；运行时 effectiveRegistry 由 builtin + 自定义合并产生
  - 加 `applyCustomSchemas(home)`：app 启动一次调用，结果是 `{ applied, skipped }` 让 caller 决定是否提示
  - `getSchemaForScope` 改读 effectiveRegistry（旧调用点透明）；CLI / sync.ts 不调 applyCustomSchemas → 拿 builtin（不影响 CI 校验语义）
  - 加 `resetCustomSchemas()` 测试用
- **`types.ts` `FieldSchema` 加 `advanced?: boolean`**：默认隐藏的「高级」字段标识，UI 顶部 toggle 可临时翻出
- **`claude-settings.ts` 字段补全**（按 schemastore.org/claude-code-settings.json 对照 ~12 个常见字段）：enableAllProjectMcpServers / enabledMcpjsonServers / disabledMcpjsonServers / disableAllHooks / skippedMarketplaces / skippedPlugins / forceLoginMethod / alwaysThinkingEnabled / prefersReducedMotion / showTurnDuration / terminalProgressBarEnabled / spinnerTipsEnabled / prUrlTemplate
- **`claude-settings.ts` KV 化**：`extraKnownMarketplaces` / `pluginConfigs` / `hooks` / `enabledPlugins` 从 `type=object additionalProperties=true` 改成 `type=kv-map`（带 valueSchema），UI 渲染成可编辑的 KV row 而非「⚠ unknown」badge 列。
  - **enabledPlugins 格式纠正**：上游官方是 `object`（kv-map of bool），不是 `array of map`（之前误判已纠正；用户 settings.json 也同步 flatten，详见 reviews/REVIEW_5 Follow-up）
- **`codex-config.ts` 字段补全**（按 codex-rs/core/config.schema.json 对照 ~15 个常见字段）：notify / instructions / developer_instructions / chatgpt_base_url / openai_base_url / oss_provider / commit_attribution / default_permissions / service_tier / review_model / tool_output_token_limit / allow_login_shell / check_for_update_on_startup / hide_agent_reasoning / show_raw_agent_reasoning / disable_paste_burst / model_supports_reasoning_summaries / include_apps_instructions / include_environment_context / include_permissions_instructions / marketplaces / plugins / skills / tools / web_search
- **`codex-config.ts` 加 `personality` 字段**：Codex CLI 新增字段（pragmatic / concise / friendly / formal，enumOpen=true）
- **`codex-config.ts` mcp_servers 改 kv-map**（之前是 object）
- **`opencode-config.ts` KV 化**：`provider` / `agent` / `tools` / `command` / `mcp` 改 kv-map；常见字段补全：lsp / tool_output / logLevel / shell / username

### `src/client/`（UI 与 bridge）

- **`bridge.ts`**：
  - 加 `readDir(path)` 调用新 Tauri IPC
  - 加 `loadUiPrefs()` / `saveUiPrefs(prefs)` 持久化 `~/.dch/ui-prefs.json`（含 hiddenFields per ScopeKind）
- **`App.tsx`**：startup 流程改造 — 先 getHomeDir → applyCustomSchemas（自定义 schema 合并）→ 并发 loadAllConfigs + loadUiPrefs → 用 RootUiPrefsProvider 包整个 main 区域
- **`components/fields/ui-prefs-context.tsx`（新增）**：双层 Context — RootUiPrefsProvider 持久化 + showHidden 全局 state；ScopedUiPrefsProvider 注入当前 scopeKind 给 root ObjectField / FieldMenu / SchemaScopeBody 顶部 toggle 用
- **`components/fields/FieldMenu.tsx`（新增）**：root level 字段右上「⋯」popover 菜单，按钮文案根据当前字段是否在 hiddenKeys 里动态显示「隐藏此字段」/「取消隐藏」（点击 toggle，写盘）。click outside / Esc 关闭
- **`components/schema-mode/SchemaScopeBody.tsx`**：拆出 `SchemaScopeBodyInner`（在 ScopedUiPrefsProvider 内才能 useScopedUiPrefs）；顶部加「▸ 显示隐藏字段（N）」toggle，仅 hiddenCount > 0 时出现
- **`components/fields/ObjectField.tsx`**：root level（path === "" 且 useScopedUiPrefs 非空）按 hiddenKeys + advanced 过滤 visibleKeys，给每个 root 子字段挂 `<FieldMenu fieldKey={key} />`；嵌套 ObjectField 不过滤、不挂 menu（粒度仅 root，与 plan 一致）
- **`components/fields/FieldRow.tsx`**：加可选 `menu` prop slot；advanced badge
- **`components/fields/types.ts` `FieldProps`**：加 `menu?: React.ReactNode`
- **12 个 leaf field**（StringField/NumberField/BooleanField/EnumField/PathField/SensitiveField/ArrayField/ObjectField/KVMapField/CodeField/MarkdownField/UnknownField）：函数签名 + FieldRow 调用都加 `menu` prop drill
- **`styles.css`**：
  - `.field-menu` / `.field-menu-button` / `.field-menu-popover` / `.field-menu-item`（菜单 popover）
  - `.field-badge.advanced`
  - `.schema-hidden-toggle` / `.schema-hidden-toggle-btn`
  - 嵌套布局修复：`.field-object-body / .field-array-card-body / .field-kv-value` 内的 `.field-row` 改 `grid-template-columns: 1fr` 纵向 stack（之前 nested 200px label + 1fr grid 在 KV value 列里被挤出布局，造成 source 字段错位到外层 KV key 同高度）
  - `.field-row` label 列从 200px 缩到 160px、`.field-kv-row` key 列改 `minmax(120px, 180px)` + `.field-kv-key` 加 `width: 100%`（之前 input 默认 size 撑出 grid 列宽，value 列被压缩）

### `src-tauri/`

- **`lib.rs` 加 `read_dir(path)` IPC**：返回 `Vec<{name, isFile}>`；安全边界：拒绝任何不在 `$HOME` 下的路径；不存在的目录返回空 Vec（不当 error，让 caller 路径更平）；跳过 dotfile

### `package.json` / `patches/`

- **新增 `patches/ebnf@1.9.1.patch`** + `patchedDependencies.ebnf@1.9.1`：bun patch 持久化 `node_modules/ebnf/dist/Grammars/W3CEBNF.js` 的 CJS interop 修复（让 Bun bundler 能正确解析 `import EBNF from "ebnf/..."` 的 default import；否则 `@sagold/json-query` 顶层 `new EBNF.Parser(...)` throw → React 整个起不来 → app 卡 raw HTML 的 "Loading..."）。详见 reviews/REVIEW_5

### 文档

- **`README.md` 新增「自定义 schema」章节**：scopeKind 与配置文件对应表、最小 override 示例、加自定义字段示例、合并语义、错误隔离说明
- **`README.md` 新增「字段隐藏」章节**：⋯ 菜单流程、ui-prefs.json 持久化位置、advanced 字段说明、顶部 toggle 行为
- **`reviews/REVIEW_5.md`**（同次会话内已增量记录）：覆盖整个 hot-fix + augmentation 系列的踩坑与对抗反向校准教训（不要从单一脏数据反推上游 schema 格式）

## 备注

- **Phase 边界**：本次集中在 schema 知识可扩展性（自定义 schema） + 字段渲染噪音控制（隐藏 + advanced）。**未做** dotted path 隐藏（嵌套字段隐藏）/ 自定义新 ScopeKind / 自定义 schema 热重载 / 在 UI 里直接编辑自定义 schema 文件 — 这些是后续待办（详见 `reviews/REVIEW_5.md` 后续待办节）
- **schema advanced 标签 batch 升级单独留 PR**：本次只加 `advanced` 字段定义，没把现有 schema 字段批量打标签（如 codex 的 experimental_*、claude 的 companyAnnouncements 等）
- **ScopeKind 限定 5 个**：custom schema 只能覆盖 claude-settings / claude-mcp / codex-config / opencode-config / dch-store；新增 ScopeKind 涉及 detectScope / 路径绑定 / 侧栏 / readers，工程量大留后续
- **隐藏跨 profile 行为**：`~/.dch/ui-prefs.json` 在 `~/.dch/` 下，不在 profile configDir 里 → 切换 profile 隐藏配置**会继承**（保持不变）。如果以后有 per-profile 隐藏需求再演进
- **关联 review**：[reviews/REVIEW_5.md](../../reviews/history/REVIEW_5.md) 全程记录了本系列从「卡 Loading」hot-fix 到 PR-CSv1 自定义 schema + 字段隐藏的踩坑与设计决策
