# REVIEW_10 — hooks.ts Bun Subprocess.kill typecheck 修复

> 完成时间:2026-06-09
> 关联 changelog:无（pure typecheck hot-fix）

## 触发场景

用户 issue `a99867e6-5ffa-43a7-90e2-ebaf8e031c54`：`./node_modules/.bin/tsc --noEmit` 在进入当前 UI 改动检查前失败。

报错：

```text
src/profiles/hooks.ts(109,22): error TS2345: Argument of type 'Subprocess<"ignore", "pipe", "pipe">' is not assignable to parameter of type '{ pid: number | null; kill: (signal?: string | number | undefined) => void; }'.
```

## 方法

- 复现 `./node_modules/.bin/tsc --noEmit`，确认唯一失败点是 `src/profiles/hooks.ts` 的 `killProcessGroup(proc)` 参数类型。
- 查阅 `node_modules/bun-types/bun.d.ts`：`Subprocess.kill(exitCode?: number | NodeJS.Signals): void`。
- 回看 `REVIEW_7.md` / `CHANGELOG_12.md`，确认 `killProcessGroup` 的行为约束是 Unix 下 `process.kill(-pid, "SIGKILL")` 杀进程组，兜底路径只需要无参 `proc.kill()` 杀 direct child。

## 三态裁决清单

| 状态 | 严重度 | 位置 | 裁决 |
|---|---|---|---|
| ✅ | MED | `src/profiles/hooks.ts` | helper 参数把 `kill` 声明成 `(signal?: string | number) => void`，比实际调用需求更宽，且不匹配 Bun 的 `NodeJS.Signals` 联合类型。改成 `kill: () => void` 后仍满足所有 callsite，且保留兜底 direct child kill 语义。 |
| ❌ | LOW | `src/profiles/hooks.ts` | 不需要把 helper 改成完整 `Bun.Subprocess` 类型。该 helper 只依赖 `pid` 和无参 `kill()`；引入完整类型会把 stdout/stderr 泛型也带进来，扩大不必要耦合。 |
| ❓ | LOW | 测试覆盖 | 没新增单测。这里是 TypeScript 结构类型修复，现有 `tsc --noEmit` 即覆盖回归；运行时行为未改变。 |

## 修复条目

- `src/profiles/hooks.ts`：`killProcessGroup` 参数类型从 `{ pid; kill(signal?) }` 收窄为 `{ pid; kill() }`。

## 验证

- `./node_modules/.bin/tsc --noEmit`
