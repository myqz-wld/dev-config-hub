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
