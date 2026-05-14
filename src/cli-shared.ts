#!/usr/bin/env bun
/**
 * cli-profile / cli-backup 共享 helper：JSON_MODE 状态 + 输出 / 错误 / stdin / parse helper。
 *
 * 抽出 cli-shared.ts 让 cli-profile.ts 不再单文件超 500 行护栏（CLAUDE.md 现存超标已知）。
 *
 * 关键约束（CHANGELOG_12 REVIEW_7 H1 实证）：
 * - Bun stdout=pipe 场景下单次 `process.stdout.write(big)` + 立即 `process.exit(0)` 在 ≥ 65537 byte
 *   时**必被截断到 65536 byte**（macOS pipe buffer 上限）。所有 stdout 输出统一走
 *   `process.stdout.write(data, callback)` 形式（callback 触发即代表 OS 已收）。
 * - `process.stdout.end(cb)` / `'drain' event` 都不能保证 flush；只有 write+callback 生效。
 *
 * JSON_MODE 用 module-level mutable state + setter / getter。ESM `export let` importer 看到 live
 * binding 但不能 reassign，所以走 setter；导出 `isJsonMode()` 让 cmd 函数 `if (isJsonMode()) ...`。
 */

import { c } from "./cli-colors.ts";

let _jsonMode = false;

export function isJsonMode(): boolean {
  return _jsonMode;
}

export function setJsonMode(v: boolean): void {
  _jsonMode = v;
}

/**
 * 写零字节强制让 Bun 把已 buffered 的字节真正 flush 到 pipe；callback 触发即代表 OS 已收。
 * 配合 dispatcher 末尾 `await flushStdout(); process.exit(0)` 用，防 65536 截断。
 */
export function flushStdout(): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write("", () => resolve());
  });
}

export async function jsonOut(data: unknown): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write(JSON.stringify(data) + "\n", () => resolve());
  });
}

/**
 * 给 cmdEnv 这种「多行 export 直接走 process.stdout.write」的非 JSON 路径用：
 * 同样有 65536 截断风险（codex MED-A1：cmdEnv 大 env 场景下也会被 process.exit 截断）。
 */
export async function writeOut(s: string): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write(s, () => resolve());
  });
}

export function err(msg: string): never {
  if (_jsonMode) {
    // err() 类型契约是 never（不 return），用 setImmediate 起一个微小异步窗口让 callback 触发后
    // 再 exit(1)，throw 兜类型让 TS 满意（callback 是异步的，throw 先于 callback 触发）。
    process.stdout.write(JSON.stringify({ error: msg }) + "\n", () => process.exit(1));
    throw new Error(msg);
  }
  console.error(`${c.red}${msg}${c.reset}`);
  process.exit(1);
}

export function ok(msg: string): void {
  if (_jsonMode) return;
  console.log(`${c.green}✓${c.reset} ${msg}`);
}

export function info(msg: string): void {
  if (_jsonMode) return;
  console.log(`${c.gray}${msg}${c.reset}`);
}

// 已知带值的 flag。next arg 一律当 value 收下，不再用 startsWith("--") 误判，
// 否则用户传 --pre-hook '--foo' 这类 hook 字面值会被吞。
export const VALUE_FLAGS = new Set([
  "dir", "desc", "from", "pre-hook", "post-hook",
  "out", "profiles", "prefix", "rename",
]);

/**
 * 解析 CLI flags + envPairs。
 * - `--env KEY=VALUE` 收集到 envPairs（manager.ENV_KEY_RE 校验在 cmd 层做）
 * - `--key value` 在 VALUE_FLAGS 里 → 一定取下一个 arg 当 value（即便 value 以 -- 开头）
 * - `--key` 不在 VALUE_FLAGS 且下一个 arg 以 -- 开头 → boolean true
 *
 * **REVIEW_8 M11 / B6**：
 * 1. VALUE_FLAGS 末尾缺 value → 直接 throw（旧行为静默变 boolean true 让 backup --out 写到
 *    undefined / cmdAdd --pre-hook 缺 hook 内容这种沉默错误，难定位）
 * 2. `--env BADFORMAT` 缺 `=` → 直接 throw（旧用 err()→process.exit 不可测试）
 * 3. opts.allowedFlags 设置时 → 未知 flag 直接 throw（防 typo 如 `--no-share` vs `--no-shared`
 *    被 silently 当 boolean 收下导致 cmd 走默认路径）。caller opt-in，未设时维持旧宽松语义。
 *
 * 抛 Error 而非 err() 让单测能 toThrow 验证；外层 main().catch(B1) 在 json 模式会 jsonOut。
 *
 * export 给单测用（CHANGELOG_5 反复修过这块没 spec 易再退化）。
 */
export function parseFlags(
  argv: string[],
  opts?: { allowedFlags?: Set<string> },
): {
  positional: string[];
  flags: Record<string, string | true>;
  envPairs: [string, string][];
} {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const envPairs: [string, string][] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--env") {
      const kv = argv[i + 1];
      if (kv === undefined) throw new Error("--env 需要 KEY=VALUE 形式: 缺 value");
      i++;
      const eq = kv.indexOf("=");
      if (eq < 0) throw new Error(`--env 需要 KEY=VALUE 形式: ${kv}`);
      envPairs.push([kv.slice(0, eq), kv.slice(eq + 1)]);
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      if (opts?.allowedFlags && !opts.allowedFlags.has(key)) {
        throw new Error(
          `未知 flag --${key}（typo? 检查与允许集合: ${[...opts.allowedFlags].sort().join(", ")}）`,
        );
      }
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(key)) {
        // 已知带值的 flag：必须有 next，否则报错。下一个 arg 一律当 value（即便 -- 开头）。
        if (next === undefined) throw new Error(`--${key} 需要 value，但末尾缺失`);
        flags[key] = next;
        i++;
      } else if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, envPairs };
}

/**
 * stdin 单行读取。Ctrl+D / EOF 视为空输入（caller 当"取消"）。
 * data / end listener 都清干净，避免 keep-alive 阻塞 dispatcher 末尾 process.exit(0)。
 */
export async function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    let acc = "";
    process.stdin.resume();
    const onData = (d: Buffer) => {
      acc += d.toString();
      if (acc.includes("\n")) {
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("end", onEnd);
        resolve(acc.trim());
      }
    };
    const onEnd = () => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(acc.trim());
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
