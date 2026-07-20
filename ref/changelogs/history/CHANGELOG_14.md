---
changelog_id: 14
changed_at: 2026-05-12
---

# CHANGELOG_14: 删 schema 系统 + 列表模式 + 新建表单简化 + 自定义下拉

## 概要

把 PR-A..D 引入的 schema-driven 行内编辑全套（CHANGELOG_8/9）以及配置文件的「列表」模式整片删除，配置文件视图退化为简单三态：**view（CodeMirror 只读）/ edit（CodeMirror 可写）/ render（仅 markdown）**。新建 profile 表单去掉 model / reasoning_effort 单独字段，主配置文件走 textarea 一把梭。原生 `<select>` 替换为自定义深色 `Select` 组件，与整体主题对齐。

动机：schema 系统维护成本高（24 文件 + 21 字段控件 + sync.ts 拉上游 + ajv 校验 + custom override），但用户视角只是「点开看一眼配置」。删完后，前端代码量从 schema/fields 的 ~3500 行 → 0；CSS 从 450 → 278 行；npm dep 数量不变（保留 codemirror-json-schema 给 dch-store schema 的 lint 用）。

## 变更内容

### 删除的文件 / 目录

- `src/schemas/`：删 `claude-mcp.ts`、`claude-settings.ts`、`codex-config.ts`、`opencode-config.ts`、`registry.ts(+test)`、`sync.ts`、`validator.ts(+test)`、`json-patcher.ts(+test)`、`toml-patcher.ts(+test)`、`helpers.ts(+test)`、`custom-loader.ts(+test)`、`diff.ts`、`index.ts`、`dch-store.test.ts`
- `src/client/components/schema-mode/`：整目录（`SchemaScopeBody.tsx(+test)`）
- `src/client/components/fields/`：整目录（11 个原子控件 + FieldRow / FieldMenu / errors-context / ui-prefs-context / index / types）
- `src/descriptions.ts`：CLAUDE/Codex/OpenCode 描述字典

### 保留的 schema 残余（仅服务于 `~/.dch/profiles.json` 编辑器）

- `src/schemas/types.ts`：`FieldSchema` / `ToolSchema` 类型定义
- `src/schemas/dch-store.ts`：dch profile 状态文件 schema
- `src/schemas/to-json-schema.ts(+test)`：FieldSchema → JSON Schema 转换（codemirror-json-schema 消费）
- `src/client/components/editor/schema-lint.ts`：CM6 lint extension 工厂
- `src/client/components/profile/ProfileStoreEditor.tsx`：唯一仍走 schema-aware 编辑的入口

### `src/types.ts`

- 删 `ConfigEntry` / `ConfigCategory`
- `ConfigScope` 删 `parsed` / `categories` 字段，只剩 `level / label / filePath / exists / format / content / loadedMtimeUs?`

### `src/readers/*` + `src/cli.ts`

- `claude-code.ts` / `codex.ts` / `opencode.ts` / `shell.ts`：删 `jsonToEntries` / `tomlToEntries` / `descriptions` 依赖；reader 只产 path/content/exists/format
- `cli.ts`：删 `renderEntry` + `cat.items` 渲染，scope 输出统一为「按行 print 原文 + comment 灰色」

### `src/client/bridge.ts`

- 删 `toEntries` / `readJsonScope` / `import { *_DESCRIPTIONS } from "../descriptions.ts"` / `import type { ScopeKind } from "../schemas/registry.ts"`
- 删 `UiPrefs` / `loadUiPrefs` / `saveUiPrefs`（fields 没了无人用）
- `loadAllConfigs` 改用通用 `readScope(path, level, label, format)`，所有 4 个工具同款简单 path → ConfigScope

### `src/client/App.tsx`

- 删 `applyCustomSchemas` 调用、`loadUiPrefs` / `setUiPrefs`、`RootUiPrefsProvider` 包装、`onPatchSave` 函数（schema-driven 字段级保存才用）
- 仅保留 `onSave`（全文保存）传给 `ConfigPanel`

### `src/client/components/ConfigPanel.tsx`

- 大改：删 `Item` / `Val` 渲染、`SchemaScopeBody` import、`detectScope` / `getSchemaForScope` / `buildSchemaExtensions`、`toolSchema` 概念、schema/list/raw 多模式分支
- 简化为三模式：
  - `view`（默认）：`CMEditor readOnly` + 语法高亮
  - `edit`：`CMEditor` 可写 + TOCTOU `externalChanged` banner + 保存按钮（CHANGELOG_10 R_2·H1-followup 行为完全保留）
  - `render`（仅 `format === "markdown"`）：`MarkdownView`（PR-H 不动）
- 按钮组 mode-aware：markdown 文件显示「{源文件 ↔ 渲染} / 编辑」；其他文件只显示「编辑」

### `src/client/components/profile/AddProfileModal.tsx`

- 删 `cfgModel` / `cfgReasoning` 字段、`reasoning_effort` select、`parseConfigCore` 调用
- 删「模型配置 — 写入 ...」section title，主配置文件 textarea 直接接在元信息前面
- `tool` / `从已有 profile clone` 两处原生 `<select>` 替换为自定义 `Select`

### `src/client/components/profile/helpers.ts`

- 删 `REASONING_OPTIONS` / `parseConfigCore` / `generateMinimalConfig` / `tomlBasicString`
- `AddForm` 删 `cfgModel` / `cfgReasoning`
- `MAIN_CONFIG.claude.placeholder` 加 `model` 字段示例（让用户照搬）

### `src/client/components/ProfilePanel.tsx`

- onSubmit 直接用 `form.configContent.trim()`，不再 fallback 到 `generateMinimalConfig`
- 删 `generateMinimalConfig` import

### `src/client/components/Select.tsx`（新增）

- 自定义下拉框：button + popover，深色主题
- 点外部 / Esc 关闭；↑↓ Enter 键盘导航
- mousedown 选中（避免 mouseup 时 popover 已关闭点不到 item）
- placeholder + disabled + 当前值勾选 icon

### `src/client/styles.css`

- 删 `.field-*`（约 130 行）、`.schema-mode` / `.schema-saving` / `.schema-unknown-summary` / `.schema-hidden-toggle*` / `.schema-diagnostics*`
- 保留 `.schema-conflict*` 三条（ConfigPanel TOCTOU banner 复用）
- 保留 `.markdown-scope-body` + `.md-*`（PR-H 渲染样式不动）
- 新增 `.select-*`（约 18 行）配套 `Select.tsx`
- 行数：450 → 278

### `src/client/main.tsx`

- 顺手补 `override` 关键字（`noImplicitOverride: true` 历史欠的债）：`state` / `componentDidCatch` / `render`

### 测试

- `ConfigPanel.test.tsx`：删 `onPatchSave` / `parsed` / `categories` / schema-lint mock；T1/T2/T3 三个 TOCTOU banner case 全保留并适配新 ConfigPanel 签名
- `App.test.tsx`：删 `applyCustomSchemas` mock + `loadUiPrefs` mock；新增 `dchProfile.list` / `dchProfile.current` mock
- `to-json-schema.test.ts`：`CLAUDE_SETTINGS` round-trip 改用 `DCH_STORE` 验证（`profiles array of object` / `preferences.hookTimeoutMs min/max`）

### 文档

- `CLAUDE.md`：删「配置描述来源」+「Schema 系统硬约束」整节，替换为「配置文件展示与编辑」一节说明三模式 + 唯一保留 schema-aware 的 `ProfileStoreEditor`
- `README.md`：核心能力删「Schema-driven 行内编辑」表项；快速开始删「Schema 维护」三条命令；删「自定义 schema（本地 override）」节、「字段隐藏」节；项目结构同步更新（schemas/ 只剩 3 文件，components/ 删 fields + schema-mode 加 Select）

## 验证

- `tsc --noEmit`：通过
- `bun test`：114 pass / 0 fail / 12 文件（schema/fields/schema-mode 测试已随源文件删除，剩下的 profile / readers / cli / utils / store / hooks / symlink / parseFlags / exit-time / platform / App / ConfigPanel / to-json-schema 全绿）
- 用户 GUI 冒烟留待用户在 `bun run dev` 中确认

## 备注

- npm 依赖未动：`ajv` / `ajv-formats` / `codemirror-json-schema` / `jsonc-parser` 仍服务于 `ProfileStoreEditor` 的 `dch-store` schema lint。后续如确认 dch-store schema lint 也不需要可一并清掉这几个 dep
- `loadedMtimeUs` 字段在 `ConfigScope` 上保留（typedef 还在），但当前 readers / bridge 都没填充——给将来需要 mtime-based TOCTOU 校验留入口；当前 ConfigPanel TOCTOU 走 `scope.content` reactive 比对就够
