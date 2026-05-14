/**
 * 与 dch CLI 交互的核心 IPC primitive。从 bridge.ts 拆出 (REVIEW_9 D-codex LOW 1):
 * 旧实现 bridge-backup.ts 反向 import bridge.ts 的 runDch / DchCommandResult / TIMEOUT_*
 * 形成双向 import,职责边界混乱。
 *
 * 拆出 bridge-core.ts 后单向链: bridge-core ← bridge / bridge-backup,
 * 两个 facade 各自 import core 不再互相耦合。
 *
 * 5 个 export:
 * - `DchCommandResult`         Rust `run_dch_command` Tauri command 的返回 shape
 * - `runDch<T>(args, timeoutMs)` 通用 `dch profile <args> --json` 调用器,自动 parse JSON +
 *   错误处理 (含 truncated / timeout / non-zero exit / 空 stdout 各种边界)
 * - `TIMEOUT_FAST_MS` / `TIMEOUT_INIT_MS` / `TIMEOUT_BACKUP_MS` 三档常用超时常量
 */

import { invoke } from "@tauri-apps/api/core";

export interface DchCommandResult {
  stdout: string;
  stderr: string;
  code: number;
  /** REVIEW_8 R2 R2-12 / R3 G6:proc_timeout reader 触 5MB cap 时为 true。
   * UI 侧拿到 `truncated=true` 应警示用户「输出过大已截断」,避免按截断 stdout
   * parse JSON 误以为完整。Rust DchCommandResult 同字段,通过 `serde(rename_all = "camelCase")` 同步。 */
  truncated: boolean;
}

/**
 * `dch profile <args> --json` 通用调用器。auto-append `--json` flag。供 dchProfile / dchBackup
 * 共用。
 *
 * **REVIEW_9 D-MED-2 / C-codex LOW 3 跨批**: parse stdout 前优先检查 `r.truncated` throw 清晰
 * 错误。旧实现忽略 truncated → 5MB 上限被截断的成功 JSON 退化成 parse error,用户看到「JSON
 * Unexpected end of input」一头雾水(实际是 dch 输出过大)。
 */
export async function runDch<T = unknown>(args: string[], timeoutMs?: number): Promise<T> {
  // REVIEW_7 H2:按命令传 timeoutMs;Rust 端 spawn_with_timeout 兜底 1800s 上限。
  // 不传 = Rust 默认(30 分钟,覆盖最坏 hookTimeoutMs 600000ms × 2 + 余量)。
  const r = await invoke<DchCommandResult>("run_dch_command", { args: ["profile", ...args, "--json"], timeoutMs });
  if (r.code === -2) {
    throw new Error(`命令超时被强制终止 (timeout=${timeoutMs ?? "default"}ms)。检查 hook 脚本是否阻塞`);
  }
  if (r.truncated) {
    throw new Error(
      `dch 输出超 5MB 上限被截断 (timeout=${timeoutMs ?? "default"}ms),无法完整解析 JSON。请缩减 backup scope / 拆批操作`,
    );
  }
  if (r.code !== 0) {
    let parsed: { error?: string } = {};
    try { parsed = JSON.parse(r.stdout) as { error?: string }; } catch {}
    throw new Error(parsed.error || r.stderr.trim() || `exit ${r.code}`);
  }
  if (!r.stdout.trim()) return undefined as T;
  return JSON.parse(r.stdout) as T;
}

export const TIMEOUT_FAST_MS = 10_000;   // 纯文件读写: list / current / show / add / remove / env / config
export const TIMEOUT_INIT_MS = 30_000;   // init: 含 mv + ln 等 fs 操作
export const TIMEOUT_BACKUP_MS = 5 * 60_000;  // backup / restore: 含 7000+ 文件 walk + tar gzip / untar + 占位符替换
