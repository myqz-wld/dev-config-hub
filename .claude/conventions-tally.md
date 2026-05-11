# 项目约定候选（待观察）

> 由 Claude Code 自动维护。**不要手工删条目**。
> 流程见 `~/.claude/CLAUDE.md`「反复反馈 / 反复踩坑 → 升级约定」节。
> count ≥ 3 时走「决策对抗」三态裁决后升级到 [CLAUDE.md](../CLAUDE.md)「项目特定约定」节。

---

# 用户反馈候选

按 `count` 倒序。

| ID | 描述 | count | first_at | last_at | 触发样例 |
|----|------|-------|----------|---------|----------|

---

# Agent 踩坑候选

按 `count` 倒序。

| ID | 描述 | count | first_at | last_at | 触发样例 |
|----|------|-------|----------|---------|----------|
| AP-1 | `??` 与 `\|\|` 在 `String.trim()` 兜底场景的语义差异：trim() 永远返 string 不是 nullish，`?? "fallback"` 永不命中 | 1 | 2026-05-04 | 2026-05-04 | REVIEW_1 M1: bridge.ts:135 `parsed.error ?? r.stderr.trim() ?? \`exit ${r.code}\`` 让 UI Error toast 显示空字符串 |
| AP-2 | UI fire-and-forget async + 同步 setState 关闭编辑视图 = 数据丢失隐患（保存失败 textarea 已卸载，buf 留 state 但用户拿不到，再点编辑 setBuf(scope.content) 覆盖） | 1 | 2026-05-04 | 2026-05-04 | REVIEW_1 H2: ConfigPanel.tsx:70 `onClick={() => { onSave(...); setMode("view"); }}` |
| AP-3 | read-modify-write 三步无锁多进程并发 = lost update（任何 `loadStore → mutate → saveStore` 模式都需要文件锁 / CAS / 单写者收敛） | 1 | 2026-05-04 | 2026-05-04 | REVIEW_1 H3: profiles/store.ts manager 7 处写操作；spawn 5 child push 实测丢 4 |
| AP-4 | `Bun.spawn` `proc.kill()` 默认 SIGTERM 被 `trap "" TERM` 屏蔽；hook 脚本 detach 子进程持 stdout pipe 让 `new Response(proc.stdout).text()` 永不 resolve → timeout 名存实亡 | 1 | 2026-05-04 | 2026-05-04 | REVIEW_1 H1: profiles/hooks.ts:39-54；实测 timeout=5s 实际 10010ms 卡死 |
| AP-5 | assert / guard / catch 路径必须有真实触发场景的实证测试。触发不到的 assert 是 dead code 嫌疑，要么删要么加 `// known dead under <dep>@<version>, kept as regression net` 显式说明 | 1 | 2026-05-06 | 2026-05-06 | REVIEW_3 R_2 D1: assertValidJsonOut 在 jsonc-parser@3.3.1 下实证无触发场景（所有 silent corruption 候选都被外层 try/catch 截），但注释 + 测试名暗示在防 silent corruption |
| AP-6 | 跨边界（useEffect / useMemo / Compartment 等）传引用要么直接透传要么 deps 短路。**禁止**组件内部 `[...arr]` 解构生新 ref 让 caller useMemo 稳定的引用失效，否则 reconfigure / re-render 会触发 noop transaction | 1 | 2026-05-06 | 2026-05-06 | REVIEW_3 R_2 D3: CMEditor.tsx `extraCompartment.current.of([...extraExtensions])` 即便 caller useMemo 稳定也会触发 noop reconfigure |
| AP-7 | OS 系统调用 Err 路径与正常空值不能在 None 合并。任何 `.ok().and_then(...).map(...)` 链式归并多种 Err 来源时，必须区分语义 —— 至少 stderr 留痕，要么独立字段（`mtime_error`）要么 sentinel value（`Some(0)`） | 1 | 2026-05-06 | 2026-05-06 | REVIEW_3 R_2 D2: lib.rs read_file_with_mtime 把 metadata.modified() Err / duration_since(UNIX_EPOCH) Err / file missing 三种 None 来源合并，PR-D consumer 无法区分 |
| AP-8 | 前端 / Tauri webview 禁用 `process.env.*`：① webview 无 `process` 全局，运行时 throw；② bun bundler 默认会 inline `process.env.X` 让**开发机路径 / 密钥**直接写进 bundle，发到用户机器 → 路径错 + 信息泄漏。一律走 IPC 异步拿（如 Tauri `getHomeDir()`），即便要付 1 trip async 代价 | 1 | 2026-05-06 | 2026-05-06 | REVIEW_4 R_2 R-H1: PathField.tsx 之前用 `process.env.HOME` 做 expandHome ~/ 折叠，bun bundler inline 后开发机路径写进 bundle |
| AP-9 | 「schema / 类型校验严过上游」反而是回归 —— 真实合法值在 UI 标红 / 拒收。任何 schema 上加 pattern / enum / `additionalProperties: false` 比上游严之前，必须 WebFetch 上游 schema 实证「上游真的禁了这个」。Hint 类校验（如 keyPattern 仅给 UI 红框 + CLI 守门）不要让 ajv 严拒 | 1 | 2026-05-06 | 2026-05-06 | REVIEW_4 R_2 R-H2: to-json-schema.ts kv-map case 之前 `additionalProperties: keyPattern ? false : valueSchema` 让合法 lowercase env (`http_proxy`) ajv 拒，与上游 `patternProperties + additionalProperties: { type: string }` 不一致 |
| AP-10 | React 19 移除了 async 期间 unmount setState 的 console warning，「悄悄犯错」入口变多。任何 `await asyncCall(); setState(...)` 之间组件可能 unmount 的场景（dialog / fetch / IPC），必须 `mountedRef.current` / cleanup flag 显式守门，否则触发幽灵 onChange / 静默改盘 | 1 | 2026-05-06 | 2026-05-06 | REVIEW_4 R_2 R-M1: PathField.tsx onPick `await openDialog(...)` 期间组件可能 unmount，幽灵 onChange 写盘 |
| AP-11 | useEffect deps 含 boolean state guard，会让 state 转换时 effect 重跑用 stale prop。修法套路：boolean guard 用 `useRef` 镜像 + 无 deps useEffect 同步；effect deps 只保留真业务输入；async 函数内部状态用独立 ref + try/finally 显式管理 | 1 | 2026-05-11 | 2026-05-11 | REVIEW_6 撞 3 次同根因：R_1·MED-double（saving 进 deps）+ R_2·R1-residual（writingRef 不靠 saving）+ R_2·N-conflict-lost（conflictRef 镜像） |
| AP-12 | fix 1 条 finding 后 fix 自身常引出新 finding（R_1 4 fix → R_2 又挖出 4 fix，其中 H1 fix 不充分诱发 H1-followup HIGH）。「banner 显示 ≠ 行为约束」是 UX 修复盲区典型：加 banner 不等于真拦截，必须把 banner 状态接到底层 disabled / gate 表达式。Round 2 必跑（即便 Round 1 fix 看起来都做了） | 1 | 2026-05-11 | 2026-05-11 | REVIEW_6 R_2·H1-followup: ConfigPanel.tsx 保存按钮 disabled={saving} 没接 externalChanged，banner 是装饰品，6 步必中数据丢失 |
| AP-13 | window/document event listener fix 在 React 18+ 默认安全：cleanup 正确 removeEventListener + 闭包引用一致 + 稳定 useCallback deps，Strict Mode 双 mount 无残留。同样姿势可直接复用，不必每次怀疑泄漏。**反例**：每次都用「listener leak？」当 review focus 浪费 token | 1 | 2026-05-11 | 2026-05-11 | REVIEW_6 R_1: focus + visibilitychange listener 在 App.tsx + ProfilePanel.tsx 双方 reviewer 检查 cleanup 都正确 + Strict Mode 验证无残留 |
