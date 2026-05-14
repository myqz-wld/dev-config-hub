/**
 * 备份还原阶段的 path 安全 helpers。从 backup-restore.ts 拆出(REVIEW_9 G6 拆模块,顶 500 LOC 护栏)。
 *
 * 主要导出:
 * - `RESTORED_BASE` / `RESTORE_BLACKLIST` 常量(restore 默认根目录 + 不可写黑名单)
 * - `safeJoinUnderRoot(rootAbs, rel)` 把 rel join 到 rootAbs 下,保证不逃逸 rootAbs 子树
 * - `validateRestorePath(absPath)` 校验 path 是否允许写入,返 null = 允许 / string = reject 原因
 * - `normalizePath(p)` 折叠 `//` + 去尾 `/`,做 dir 撞车校验用
 *
 * 设计原则: 这些 helpers 都是「纯字符串校验 / 拼接」逻辑,不碰 fs;backup-restore.ts 主流程
 * 调它们做安全检查后再做 fs 操作。caller 仍 `import { validateRestorePath } from
 * "./backup-restore.ts"` 不变 — backup-restore.ts 顶部 re-export 透传。
 *
 * REVIEW_8 R2 R2-3/R2-4/R2-6/R2-9/R2-10 / R3 G1 / REVIEW_9 G4 path safety hardening 历史详
 * backup-restore.ts 顶部注释。
 */

import { join, isAbsolute } from "node:path";
import { HOME, expandHome } from "./store.ts";

/**
 * Restore 默认目标根目录:`~/.dch-restored/<finalId>/`。
 * 与 manifest 携带的 configDir_original 隔离,避免恶意 .dchpack 写到 `~/.ssh` /
 * `~/Library/LaunchAgents` 等敏感路径。`--allow-original-path` opt-in 才允许尊重原路径,
 * 仍走 validateRestorePath 二道防线。
 */
export const RESTORED_BASE = join(HOME, ".dch-restored");

/**
 * 即便在 HOME 内也禁止 restore 写入的子树。任何 `restored path` 命中 RESTORE_BLACKLIST
 * 任一段 (或其祖先 — restore 写入会创建子树触发) → reject。
 */
export const RESTORE_BLACKLIST = [
  ".ssh",
  ".gnupg",
  "Library/LaunchAgents",
  "Library/LaunchDaemons",
  "Library/Application Support/com.apple.TCC", // 隐私权限 DB
];

/**
 * macOS APFS / HFS+ 默认 case-insensitive:`.SSH/authorized_keys` 与 `.ssh/authorized_keys`
 * 是同一文件。预先 lowercase 一次避免 hot path 重算。
 */
export const RESTORE_BLACKLIST_LC = RESTORE_BLACKLIST.map((s) => s.toLowerCase());

/**
 * REVIEW_8 R2 R2-3/R2-4 / R3 G1：把 rel join 到 rootAbs 下，**保证不逃逸 rootAbs 子树**。
 *
 * 用途：恶意 .dchpack 携带的 `manifest.shared.dch_scripts[i] = "../../.ssh/authorized_keys"`
 * 走 `join("$HOME/.dch/scripts", rel) = "$HOME/.ssh/authorized_keys"` 真能逃逸到敏感路径。
 * 本 helper 用四道防线拒：null byte / 绝对路径 / `..` 段 / startsWith rootAbs 二道校验。
 *
 * 返回 null = rel 不安全；返回 string = 安全 join 后的绝对路径。
 *
 * **case-insensitive note**：startsWith 用原始 case 比较；rootAbs 由 caller 控制（固定 const
 * 不来自外部输入），rel 来自 manifest（attacker controlled）但前面 `..` 校验已挡。极端 case
 * insensitive APFS 上同名 dir 不同 case 不影响安全（仍指同 inode），仅影响日志可读性。
 */
export function safeJoinUnderRoot(rootAbs: string, rel: string): string | null {
  if (!rel || rel.includes("\0")) return null;
  if (isAbsolute(rel)) return null;
  if (rel.split(/[/\\]/).some((s) => s === "..")) return null;
  const joined = join(rootAbs, rel);
  if (joined !== rootAbs && !joined.startsWith(rootAbs + "/")) return null;
  return joined;
}

/**
 * 校验 path 是否允许写入。返回 null = 允许；返回 string = reject 原因。
 *
 * 1. 必须绝对路径（caller 应该已 expandHome 过）
 * 2. 必须 startsWith HOME（拒 /etc/* /tmp/* /System/* 等）
 * 3. 不含 `..` 段（防 `~/foo/../../etc` 字符串绕过）
 * 4. 不能在 RESTORE_BLACKLIST 任何子树下（即便在 HOME 内）
 * 5. **不能是 RESTORE_BLACKLIST 任一段的祖先**（R2-6 修复：`$HOME/Library` 是
 *    `Library/LaunchAgents` 的祖先，opt-in 模式下 .dchpack 内 `LaunchAgents/x.plist`
 *    会落到 `$HOME/Library/LaunchAgents/x.plist` 黑名单子树）
 * 6. **大小写不敏感**比较（R2-10 修复：macOS APFS / HFS+ 默认 case-insensitive，
 *    `.SSH/authorized_keys` 与 `.ssh/authorized_keys` 同 inode）
 */
export function validateRestorePath(absPath: string): string | null {
  if (!absPath || !isAbsolute(absPath)) return `路径不是绝对路径: ${absPath}`;
  // 字符串子串扫描 .. 段（跨 / 与 \ 分隔，覆盖 fs 拼接 corner case）
  if (absPath.split(/[/\\]/).some((seg) => seg === "..")) {
    return `路径含 '..' 段: ${absPath}`;
  }
  const absLc = absPath.toLowerCase();
  const homeLc = HOME.toLowerCase();
  if (!(absLc === homeLc || absLc.startsWith(homeLc + "/"))) {
    return `路径不在 HOME 下: ${absPath}`;
  }
  const relLc = absLc === homeLc ? "" : absLc.slice(homeLc.length + 1); // strip "HOME/"
  for (const badLc of RESTORE_BLACKLIST_LC) {
    // a. absPath 在黑名单本身或其子树（既有逻辑）
    if (relLc === badLc || relLc.startsWith(badLc + "/")) {
      return `路径在 RESTORE_BLACKLIST 内: ${absPath}（黑名单段: ${badLc}）`;
    }
    // b. R2-6 修复：absPath 是黑名单的祖先（写入时 mkdir/copyDirRecursive 会创建黑名单子树）
    //    relLc === "" → absPath == HOME 是任何 bad 的祖先；显式拒
    //    badLc.startsWith(relLc + "/") → relLc 是 badLc 的真前缀（祖先）
    if (relLc === "" || badLc.startsWith(relLc + "/")) {
      return `路径是 RESTORE_BLACKLIST 祖先: ${absPath}（黑名单段: ${badLc}，写入会创建敏感子树）`;
    }
  }
  return null;
}

/**
 * 把 path 折叠成规范字符串(展开 ~,折叠 `//`,去尾 `/`)用于 dir 撞车校验。**不**解析 `..`。
 * 仅按字符串比对,不做 fs canonicalize。
 *
 * caller: backup-restore.ts existingDirs Set 比对每个候选 finalDirAbs。
 *
 * @param p 可以是 `~/...` / 绝对路径 / 相对路径(后者 expandHome 失败原样返)
 */
export function normalizePath(p: string): string {
  if (!p) return "";
  let abs = p;
  if (!isAbsolute(abs)) abs = expandHome(abs);
  return abs.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}
