---
review_id: 6
reviewed_at: 2026-05-11
expired: false
skipped_expired:
---

# REVIEW_6: CHANGELOG_10 自动刷新 3 轮异构对抗 review

## 触发场景

CHANGELOG_10「工具配置 / Profile 自动刷新（focus + 周期 mtime poll）」改动落盘前质量闸门。3 个文件 78 行新增功能，触及 React useEffect 依赖、Tauri webview event listener、5s setInterval mtime poll、saving / conflict / userTyping 多重 race window，必须走 deep code review 才能放心 ship。

## 方法

**双对抗配对**（agent-deck:deep-code-review skill teammate 模式 in-process backend）：
- **reviewer-claude**：Opus 4.7 xhigh
- **reviewer-codex**：claude-code wrapper 内部 Bash 跑 codex CLI gpt-5.5 xhigh

**轮数**：3 轮 + 2 反驳轮。Round 1 单方独有 H1 → 反驳轮 codex 同意升 ✅ HIGH；Round 2 单方独有 H1-followup → 反驳轮 codex 同意升 ✅ HIGH。Round 3 双方均判「可合」。

**范围**：4 个 .tsx 源文件（CHANGELOG_10 原 PR 改 3 + R_1 fix 引入 ConfigPanel.tsx 改） + 3 个新写 test 文件（R_3 必修 ship 阻塞）。

```text
原 PR 自动刷新功能：
  src/client/App.tsx                                     focus + visibilitychange 监听
  src/client/components/ProfilePanel.tsx                 同上模式
  src/client/components/schema-mode/SchemaScopeBody.tsx  5s mtime poll

R_1 fix 引入：
  src/client/components/ConfigPanel.tsx                  edit 模式 banner（修 H1 silent overwrite）

R_3 必修 test：
  src/client/App.test.tsx
  src/client/components/ConfigPanel.test.tsx
  src/client/components/schema-mode/SchemaScopeBody.test.tsx
```

**机器可读范围**（File-level Review Expiry 用）：

```review-scope
src/client/App.test.tsx
src/client/App.tsx
src/client/components/ConfigPanel.test.tsx
src/client/components/ConfigPanel.tsx
src/client/components/ProfilePanel.tsx
src/client/components/schema-mode/SchemaScopeBody.test.tsx
src/client/components/schema-mode/SchemaScopeBody.tsx
```

**约束**：lead 自己做三态裁决；单方 HIGH 候选必走反驳轮（同一对 reviewer 的对方）；双方一致 ✅ 直接采纳；纯文本推理 *未验证* 强制降级非 HIGH；能验证的优先 grep / 写小 test / 跑命令实证。

## 三态裁决结果

> 每条 ✅ 必须带验证手段。R_2/R_3 是 review 自身 fix 的二阶 finding（前一轮 fix 暴露的新 race / 不充分修复）。

### ✅ 真问题（已修；按发现轮 + 严重度）

| # | 严重度 | 文件:行号 | 问题 | A claude | B codex | 验证手段 |
|---|---|---|---|---|---|---|
| R_1·H1 | HIGH | ConfigPanel.tsx:70/124/147-156 + lib.rs:107-116 + App.tsx:58-67 | edit 模式 + focus reload silent overwrite：buf 只在点编辑时一次性 snapshot，scope.content 后续推变 buf 不变；用户保存覆盖外部修改无任何提示 | ✅ 5 步必中复现 | ❓→反驳后 ✅ HIGH | grep `setBuf` 全仓 2 处使用无 useEffect 同步；读 lib.rs save_file 无 mtime 校验；schema 模式 PR-G TOCTOU banner 兜底，edit 模式独缺 |
| R_1·MED-double | MED | SchemaScopeBody.tsx:62-67 | useEffect deps 含 [saving] → saving false→true 帧 effect 重跑用 stale prop 反转 setParsed → save 完 UI 回退 save 前内容 | ❓ R1 *未验证* | ✅ M1 完整触发链 | 双方独立指向同一 useEffect；codex 给 5 步触发链精准 |
| R_1·M1 | MED | SchemaScopeBody.tsx:104-114 + fields/{StringField,NumberField,PathField,SensitiveField}.tsx | 5s poll 静默 setParsed → field useEffect[value] 触发 setDraft 擦掉用户中途打字未 blur draft | ✅ MED | 未提 | grep 4 个文本字段 useEffect[value] 模式确认全中招 |
| R_1·L1 | LOW | App.tsx:17/44 | setError 从不清零 → 首次 load 失败后 focus reload 即便成功 `if (error) return <error screen>` 永远 hard-block | 未提 | ✅ LOW | grep 全文无 setError(null) |
| R_2·H1-followup | HIGH | ConfigPanel.tsx:212/182-189 | R_1·H1 的 banner fix 不充分 — 保存按钮 disabled={saving} 无 externalChanged，banner 是装饰品；用户读 banner 直接点底部保存 → 6 步必中数据丢失 | ✅ HIGH 6 步复现 | ❓→反驳后 ✅ HIGH | grep `disabled={saving}` 唯一条件；schema 模式 PR-G conflict 是硬 gate 不对称 |
| R_2·N-conflict-lost | MED | SchemaScopeBody.tsx:91-96 | prop-sync useEffect 不检 conflict → focus reload 在 PR-G TOCTOU banner 显示期间触发会 setConflict(null) 静默清掉 banner + 丢用户 conflict 对象内的 newParsed/newContent | ✅ MED 4 步 | ✅ R2-L1 LOW | grep `setConflict` 全文：poll 检 conflict，sync effect 不检；不对称 |
| R_2·M1-followup | MED | SchemaScopeBody.tsx:91-96 | R_1·M1 的 isUserTyping guard 只盖 5s poll，不盖 prop-sync 路径 → focus reload 通过 prop-sync 路径仍会擦 draft | ✅ MED | 未提 | grep prop-sync useEffect 仅 savingRef guard，无 isUserTyping |
| R_2·R1-residual | MED | SchemaScopeBody.tsx:208-235 | R_1·MED-double 的 saving guard 修了 saving false→true 但漏 handleRootChange optimistic→TOCTOU await→doSave 内 setSaving(true) 之间 5-50ms 窗口 | ❓ MED *未验证* | 未提 | claude 静态分析路径完整；lead 实证 React commit 延迟成立 |

### ❌ 反驳（评估后非问题）

| 报告方 | 报项 | 反驳依据 |
|---|---|---|
| claude / lead | window/document event listener 在 React Strict Mode / HMR 下泄漏风险 | App.tsx + ProfilePanel.tsx cleanup 都正确 removeEventListener；闭包内引用一致；React 19 Strict Mode dev 双 mount unmount 跑 cleanup 干净 |
| claude | 双源 setParsed（focus reload 推 prop + 5s poll 同时） | 两源最终都收敛到磁盘最新值；React Object.is bailout 命中或一次 noop render，correctness 无损 |
| claude | 5s poll IPC 频度过高（4 scope × N 工具） | SchemaScopeBody 仅 mode==="schema" 挂载；ConfigPanel 一次只展示一个 tool 的 scopes；上限 ≤ 0.4 IPC/s 量很小 |
| claude / codex | focus + visibilitychange 双重 load 一定触发 | macOS Tauri webview 行为：alt-tab 通常只触发 focus（窗口仍可见）；最小化才两个事件；幂等 last-write-wins 无 race |
| codex | savingRef MED fix 引入 ref-sync useEffect 顺序 race | ref-sync 定义在 prop-sync 之前 → React 同 commit 内按 source order 跑：ref-sync 先跑 prop-sync 后跑读到 fresh ref |
| codex | conflictRef + savingRef 同 useEffect 被 React batching 影响 source order | `.current = X` 直接赋值不是 setState，不走 React batching scheduler |
| codex | writingRef try/finally 漏 return 路径 | 早期 return（!computed）在 writingRef = true 之前；conflict path / throw path 都在 try 内 finally 必跑 |
| claude | 「保存按钮可被键盘快捷键 bypass disabled」 | grep CMEditor 无任何 Mod-s/Ctrl-s 自定义 keybinding；onClick 是唯一入口；HTML disabled 按钮不响应 click；无 form 包裹 Enter 不 submit |
| codex | 「保留我的改动」按钮无法再次检测下次外部变化 | 点击后 enterEditRef.current = scope.content 重置基线；下次 scope.content 再变 → !== enterEditRef.current → setExternalChanged(true) 再次弹 banner |
| codex | isUserTyping 漏 SELECT / shadow DOM | EnumField select onChange 即时 commit 无 draft；本 codebase 无 shadow DOM；StringField/NumberField/PathField/SensitiveField/ArrayField 全用 input/textarea 命中 INPUT/TEXTAREA 判断 |
| codex | isUserTyping 对 read-only CMEditor false positive | read-only CMEditor 设 editable=false → contenteditable="false" → isContentEditable=false → 不触发 |
| codex | setError(null) 引发 error→spinner→error 闪烁 | setError(null) 时 loading=false（already false）→ spinner 不命中；无中间态 |
| codex | 4 ref guard 永久 hold | 4 守卫均有明确清零路径无循环依赖 |

### ❓ 部分 / 未验证（不修；保留 follow-up 候选）

| # | 问题 | 现场 | 结论 |
|---|---|---|---|
| R_3·INFO-1 | prop-sync 末尾 `setConflict(null)` 死代码（conflictRef guard 已确保到达此行时 conflict=null，setState(null) when null React bailout） | codex 标 INFO；零运行时影响 | 可删可留，不修 |
| R_3·N3·1 | conflictRef sync delay vs setTools 跨 fiber commit race（writingRef→false 之后到 React 完成 setConflict commit + ref-sync 同步前 conflictRef 仍是 null）| claude *未验证*，conflict 对象内 newParsed/oldParsed 兜底 user intent，data integrity 不丢 | 不修；如要彻底解 handleRootChange setConflict 后同步赋值 conflictRef.current |
| R_3·N3·2 | pollStateRef 不含 writingRef → 5s poll 在 handleRootChange 写入窗口可触发 setParsed | claude *未验证*，0.1-1% × 外部并发改文件双低概率事件；handleRootChange 自己 TOCTOU setConflict 兜底 | 不修；如要补 pollStateRef 加 writing 字段 |
| R_3·N3·3 | else 对称清零边角：用户 type buf="X+edit" 同时外部 Y→X 撤销，banner 自动消但用户没意识到外部曾改 | claude INFO；无数据丢失（buf 是用户主动写） | 不修，UX 微调可作 follow-up |
| R_2·N1-h1 | onClick + focus event sub-frame race（enterEditRef 与 buf 错位） | claude *未验证*；else 对称清零让此场景有自愈能力 | 不修 |
| R_2·N2-l1 | reload 失败时把工作中 UI 拆掉（旧 error fatal 全屏 + L1 fix 对称暴露 trade-off）| claude INFO；属旧设计假设 | 不修；如要 follow-up 改 toast 化 reload 错误 |
| R_2·N5 | view=profile 时 App.load 仍 fire 浪费 IPC | claude INFO | 不修，预拉取语义可接受 |
| R_3·❓ | 并发 handleRootChange（快速连点不同字段）writingRef 不互斥 | codex *未验证*；pre-existing 问题，writingRef fix 未使其更坏 | 不修；属旧 bug 范畴 |

## 修复（CHANGELOG_10 落地）

### HIGH

1. **R_1·H1** ConfigPanel.tsx Scope 加 externalChanged + enterEditRef + edit 模式 banner（与 SchemaScopeBody PR-G TOCTOU 风格一致）
2. **R_2·H1-followup** ConfigPanel.tsx 保存按钮 `disabled={saving || externalChanged}`（banner 硬 gate）+ 「保留我的改动」按钮 `disabled={saving || buf === enterEditRef.current}`（语义错位修）+ useEffect else 对称清零分支

### MED

3. **R_1·MED-double（双方一致）** SchemaScopeBody.tsx prop-sync useEffect saving 从 deps 移除 + savingRef 镜像（修 saving false→true 帧 stale prop 反转）
4. **R_1·M1（claude 单方）** SchemaScopeBody.tsx 顶部加 isUserTyping helper + 5s poll callback 加 `if (isUserTyping()) return;`
5. **R_2·N-conflict-lost（双方一致）** SchemaScopeBody.tsx 新增 conflictRef + ref-sync useEffect 同步 + prop-sync 加 conflictRef guard
6. **R_2·M1-followup** SchemaScopeBody.tsx prop-sync 加 isUserTyping guard（与 5s poll 对齐）
7. **R_2·R1-residual** SchemaScopeBody.tsx 新增独立 writingRef + handleRootChange 整段 try/finally 包 + prop-sync 加 writingRef guard

### LOW

8. **R_1·L1** App.tsx load() try 块首行加 `setError(null)`

### Test（R_3 必修 ship 阻塞）

补 12 个 react component test 覆盖核心不变量（防未来 PR 重排 useEffect / 改 disabled 表达式静默回退）：

- **ConfigPanel.test.tsx**（3）：T1 H1 banner + 保存按钮 disabled / T2 「保留」按钮 buf===enterEditRef 时 disabled / T3 else 对称清零（X→Y→X banner 消失）
- **SchemaScopeBody.test.tsx**（8）：isUserTyping helper 6 case（body / INPUT / TEXTAREA / contenteditable=true / contenteditable=false / BUTTON）+ T4-baseline prop-sync 同步基础路径 + T4-isUserTyping focus INPUT 时 prop-sync skip
- **App.test.tsx**（1）：T7 setError(null) — mock loadAllConfigs 第一次 reject 第二次 resolve，focus event 触发 retry → error 屏切回主 UI

总计 218 → 230 pass / 0 fail / 0 回归。

## 关联 changelog

- [CHANGELOG_10.md](../changelogs/CHANGELOG_10.md)：原 PR 自动刷新功能 + 本 review 8 fix + 12 test 落地

## Agent 踩坑沉淀

本次 review 期间提炼候选（写入 `.claude/conventions-tally.md`「Agent 踩坑候选」section，count 满 3 触发升级评审）：

1. **AP-1：useEffect deps 含 boolean state guard，会让 state 转换时 effect 重跑用 stale prop**。同根因撞过 R_1·MED-double + R_2·R1-residual + R_2·N-conflict-lost 三次。修法套路：把 boolean guard 用 `useRef` 镜像 + 无 deps useEffect 同步，effect deps 只保留真业务输入；handleRootChange 这种 async 函数内部状态用独立 writingRef + try/finally 显式管理，不靠 React state 同步。
2. **AP-2：fix 1 条 finding 后 fix 自身常引出新 finding**（R_1 4 fix → R_2 又挖出 4 fix）。「banner 显示 ≠ 行为约束」是 UX 修复盲区典型：加 banner 不等于真拦截，必须把 banner 状态接到底层 disabled / gate 表达式。Round 2 必跑（即便 Round 1 fix 看起来「都做了」）。
3. **AP-3：window/document event listener fix 在 React 18+ 默认安全**：cleanup 正确 removeEventListener + 闭包引用一致 + 稳定 useCallback deps，Strict Mode 双 mount 无残留。同样姿势安全可直接复用，不必每次怀疑泄漏。

