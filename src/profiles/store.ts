import { join, relative, sep, dirname } from "node:path";
import { mkdir, open, unlink, readFile } from "node:fs/promises";
import { HOME } from "../platform.ts";
import type { ProfileStore } from "./types.ts";
import { EMPTY_STORE, applyStoreDefaults } from "./store-shape.ts";

export { HOME };
export const DCH_DIR = join(HOME, ".dch");
export const STORE_PATH = join(DCH_DIR, "profiles.json");

export function expandHome(p: string): string {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return join(HOME, p.slice(2));
  return p;
}

/**
 * 把绝对路径折叠成 `~/...` 形式（相对 HOME）。
 *
 * 跨平台细节：
 * - 用 `path.relative(HOME, p)` 而不是字符串前缀比对，自动处理 Win 反斜杠 + POSIX 正斜杠
 * - 显示形式统一用 `/`（Win 也用正斜杠展示，与配置文件 ~ 路径风格一致；不影响 fs 读写）
 * - 路径不在 HOME 下（relative 出 `..`）→ 原样返回绝对路径
 */
export function collapseHome(p: string): string {
  if (p === HOME) return "~";
  const rel = relative(HOME, p);
  if (rel === "" || rel.startsWith("..") || (sep === "\\" && /^[A-Za-z]:/.test(rel))) {
    return p;
  }
  return "~/" + rel.split(sep).join("/");
}

// loadStore / saveStore 接受可选 path 参数让单测能注入 tmpdir，不污染 ~/.dch/profiles.json。
// 生产 caller（manager.ts 全 7 处写操作）走默认 STORE_PATH 不受影响。
export async function loadStore(path: string = STORE_PATH): Promise<ProfileStore> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return structuredClone(EMPTY_STORE);
  }
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (e) {
    throw new Error(`无法解析 ${path}: ${e}`);
  }
  // 默认补全走共享 store-shape.ts.applyStoreDefaults，前端 loadProfileDataDirect 也调
  // 同一函数避免 store 版本、方案超时与备份规则默认值在两端分叉。
  return applyStoreDefaults(raw);
}

export async function saveStore(store: ProfileStore, path: string = STORE_PATH): Promise<void> {
  const dir = path === STORE_PATH ? DCH_DIR : dirname(path);
  await mkdir(dir, { recursive: true });
  // 即便调用方持有的是旧 shape，也统一以 v2 正规化结构写回；这会有意清理
  // legacy preferences.hookTimeoutMs，且不会把旧全局值迁移到任何方案。
  const normalized = applyStoreDefaults(store);
  await Bun.write(path, JSON.stringify(normalized, null, 2) + "\n");
}

export const STORE_LOCK_PATH = STORE_PATH + ".lock";

/**
 * REVIEW_2 PR-5 (#H3) 修 multi-process lost update：
 * `loadStore → mutate → saveStore` 三步若两进程并发跑会互相覆盖（实测 spawn 5 child 各 push
 * 一个 profile 最终只剩 ~2 条）。manager 所有写操作统一使用本 helper：
 * cross-process advisory lock via O_EXCL lockfile + PID + 时间戳。
 *
 * 行为：
 * - O_EXCL atomic create lockfile（NFS 上不可靠但 macOS / Linux / Win 本地 fs OK）
 * - lockfile 内容 `<pid>\n<ts_ms>\n` 给 stale 检测用
 * - 等锁最多 maxWaitMs（默认 30s = hookTimeoutMs 同量级，覆盖正常 useProfile + hook）
 * - 持锁超过 staleMs（默认 60s，给 useProfile + 30s hook 留 2x 余量）→ 视为 stale 抢占
 * - 失败重试间隔 30-100ms 抖动，避免 thundering herd
 *
 * 注意：useProfile 整体持锁包含 preSwitch hook，意味着 hook 跑期间其他 dch 写操作排队。
 * 这是合理语义：用户连点 use / 一处 GUI + 一处终端并发改 profile 应该串行而非互相覆盖。
 */
export async function withStoreLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: { maxWaitMs?: number; staleMs?: number } = {},
): Promise<T> {
  const maxWaitMs = opts.maxWaitMs ?? 30_000;
  const staleMs = opts.staleMs ?? 60_000;
  const start = Date.now();
  const myPid = String(process.pid);
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      // 'wx' = O_WRONLY | O_CREAT | O_EXCL — atomic create，已存在则 EEXIST
      const fd = await open(lockPath, "wx");
      try {
        await fd.writeFile(`${myPid}\n${Date.now()}\n`);
      } finally {
        await fd.close();
      }
      try {
        return await fn();
      } finally {
        await unlink(lockPath).catch(() => {});
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      // 锁被占：检查是否 stale，stale 就抢占
      try {
        const content = await readFile(lockPath, "utf8");
        const lines = content.trim().split("\n");
        const heldTs = Number(lines[1]);
        if (Number.isFinite(heldTs) && Date.now() - heldTs > staleMs) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        // 读 lockfile 失败：可能正在被释放，重试创建
      }
      if (Date.now() - start > maxWaitMs) {
        throw new Error(`acquire store lock timeout (${maxWaitMs}ms): ${lockPath}`);
      }
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));
    }
  }
}
