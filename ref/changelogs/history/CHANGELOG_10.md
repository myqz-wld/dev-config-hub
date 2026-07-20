---
changelog_id: 10
changed_at: 2026-05-11
---

# CHANGELOG_10: 工具配置 / Profile 自动刷新（focus + 周期 mtime poll） + REVIEW_6 8 fix 收口

## 概要

UI 加载后不会反映外部对配置文件的修改（`vim ~/.claude/settings.json` / `dch profile use` / 直接编辑 `~/.dch/profiles.json` 等），用户需要手动重启或刷新 panel 才能看到新数据。本次加双层自动刷新：① 窗口 focus / 标签页可见性恢复 → 顶层 reload，覆盖 80% 切窗口场景；② SchemaScopeBody 5s 周期 mtime poll，覆盖用户长时间停留 UI 但外部脚本改文件的边角场景。

落盘前走 `agent-deck:deep-code-review` 3 轮异构对抗 + 2 反驳轮（reviewer-claude Opus 4.7 xhigh + reviewer-codex gpt-5.5 xhigh），共修 **2 HIGH + 5 MED + 1 LOW** = 8 fix；ship 阻塞补 12 个 react component test。详见 [REVIEW_6.md](../../reviews/history/REVIEW_6.md)。

## 变更内容

### 一、自动刷新功能（原 PR）

#### `src/client/App.tsx`

- `useEffect` 新增 `window.addEventListener("focus")` + `document.addEventListener("visibilitychange")` 双监听 → 调 `load()` 全量 reload `loadAllConfigs() + loadUiPrefs()`
- 不做防抖：连切窗口仅多跑几次 IPC，比加 debounce 引入「最后一次切回还要等 N ms」的体感延迟更值得

#### `src/client/components/ProfilePanel.tsx`

- 同上模式：focus + visibilitychange → `reload(true)`（silent 模式，避免「切窗口失败」时盖掉其他 toast）
- 触发场景：用户在外部跑 `dch profile use` / 手改 `~/.dch/profiles.json` / 删 `~/.<tool>` symlink 后切回窗口

#### `src/client/components/schema-mode/SchemaScopeBody.tsx`

- 新增 5s 周期 mtime poll（`window.setInterval`）→ `readFileWithMtime(scope.filePath)` → 比对 `loadedMtimeUs`：
  - safe state guard、二次检查、mtime 不变跳过、parse 失败静默 return
  - 外部修改：silent 重新 parse + setParsed/setContent/setLoadedMtimeUs
- stale closure 防御：`useRef` 镜像；poll useEffect 只依赖 `[scope.filePath, scope.format]`

### 二、REVIEW_6 deep review 8 fix（按发现轮 + 严重度）

#### R_1 fix（4 条）

- **R_1·H1 ✅ HIGH**（双方一致 after rebuttal）— `src/client/components/ConfigPanel.tsx` Scope 加 edit 模式 conflict banner（`externalChanged` + `enterEditRef`）：
  - 进 edit 模式记基线 → scope.content 后续被外部 reload 推变 → setExternalChanged(true) → 顶部 banner 三选一（重新加载 / 保留 / 取消）
  - 与 SchemaScopeBody PR-G TOCTOU banner 风格一致
  - 修「edit 模式 + focus reload silent overwrite 5 步必中」数据丢失
- **R_1·MED-double ✅ MED**（双方独立提出）— `SchemaScopeBody.tsx` prop-sync useEffect saving 从 deps 移除 + `savingRef = useRef(saving)` 镜像：
  - 修「saving false→true 帧 effect 重跑用 stale prop 反转 setParsed → save 完 UI 回退」
- **R_1·M1 ✅ MED**（claude 单方 grep 实证）— `SchemaScopeBody.tsx` 顶部加 `isUserTyping()` helper + 5s poll 加 guard：
  - 修「poll 静默 setParsed 触发 fields useEffect[value] 擦掉用户中途打字 draft」
- **R_1·L1 ✅ LOW**（codex 单方 grep 实证）— `App.tsx` load() try 块首行加 `setError(null)`：
  - 修「首次 load 失败后 focus reload 即便成功 if (error) return error 屏 hard-block」

#### R_2 fix（4 条 — 修上轮 fix 自身漏洞）

- **R_2·H1-followup ✅ HIGH**（双方一致 after rebuttal）— `ConfigPanel.tsx` 修 R_1·H1 banner 不充分：
  - 保存按钮 `disabled={saving || externalChanged}`（banner 真正硬 gate save）
  - 「保留我的改动」按钮 `disabled={saving || buf === enterEditRef.current}`（buf 没动过时禁用，避免「没改但要覆盖」语义错位）
  - useEffect 加 `else { setExternalChanged(false); }` 对称清零（外部回退基线时 banner 自动消，修 R_2·INFO-1）
- **R_2·N-conflict-lost ✅ MED**（双方一致）— `SchemaScopeBody.tsx` 新增 `conflictRef = useRef(conflict)` + ref-sync useEffect 同步 + prop-sync 加 conflictRef guard：
  - 修「PR-G TOCTOU banner 显示期间 focus reload 静默清 conflict + 丢 newParsed/newContent」
- **R_2·M1-followup ✅ MED**（claude 单方）— `SchemaScopeBody.tsx` prop-sync 加 `isUserTyping()` guard（与 5s poll 对齐）：
  - 修「R_1·M1 isUserTyping 只盖 poll 不盖 prop-sync 路径，focus reload 仍能擦 draft」
- **R_2·R1-residual ✅ MED**（claude *未验证* + lead 代码路径实证）— `SchemaScopeBody.tsx` 新增独立 `writingRef = useRef(false)` + handleRootChange 整段 try/finally 包 + prop-sync 加 writingRef guard：
  - 修「optimistic→TOCTOU await→doSave 内 setSaving(true) 之间 5-50ms ref hold 漏洞」
  - writingRef 不被 ref-sync useEffect 覆盖，try/finally 显式管理整段执行期 prop-sync hold

### 三、R_3 必修 test（ship 阻塞）

- **`src/client/components/ConfigPanel.test.tsx`**（3 test）：T1 H1 banner + 保存按钮 disabled / T2 「保留」按钮 buf===enterEditRef 时 disabled / T3 else 对称清零
- **`src/client/components/schema-mode/SchemaScopeBody.test.tsx`**（8 test）：isUserTyping helper 6 case + T4-baseline prop-sync 同步基础路径 + T4-isUserTyping focus INPUT 时 prop-sync skip
- **`src/client/App.test.tsx`**（1 test）：T7 setError(null) — mock loadAllConfigs 第一次 reject 第二次 resolve，focus event 触发 retry → error 屏切回主 UI
- 同时 `SchemaScopeBody.tsx` 把 `isUserTyping()` helper export 给单测用（生产代码不应直接 import）

总计 12 个新 test 防未来 PR 重排 useEffect / 改 disabled 表达式静默回退到 R_1 / R_2 修过的 HIGH/MED 数据丢失场景。

## 边界与未做

- **不引 fs watcher（notify crate）**：需要新加 Rust 依赖、跨进程事件链、symlink 切换会触发风暴、event filtering 复杂；当前 focus + 5s poll 组合够用
- **顶层不做「最后刷新于 X 秒前」状态条**：避免噪音，刷新本身要静默
- **REVIEW_6 残留 2 LOW *未验证* + 多 INFO 不修**（详见 REVIEW_6.md ❓ 节）：
  - N3·1 conflictRef sync delay vs setTools 跨 fiber commit race（conflict 对象兜底 user intent，data integrity 不丢）
  - N3·2 pollStateRef 不含 writingRef → 5s poll 在 handleRootChange 写入窗口可触发 setParsed（双低概率事件 + handleRootChange 自己 TOCTOU 兜底）
  - R_2·N2-l1 reload 失败时把工作中 UI 拆掉（旧 error fatal 全屏 trade-off，建议 follow-up 改 toast 化）
  - R_3·INFO-1 prop-sync 末尾 `setConflict(null)` 死代码（conflictRef guard 已确保到达此行时 conflict=null，零运行时影响）

## 备注

- **验证**：`bun test` 218 → **230 pass / 0 fail**（+12 新 component test）；`bunx tsc --noEmit` 改动文件零新增错误
- **关联 review**：[REVIEW_6.md](../../reviews/history/REVIEW_6.md)（3 轮异构对抗 + 2 反驳轮 + 三态裁决完整记录 + Agent 踩坑沉淀 AP-1/AP-2/AP-3）
