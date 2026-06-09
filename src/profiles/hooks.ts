import type { Profile, HookResult, HookScript } from "./types.ts";
import { expandHome } from "./store.ts";
import { defaultShellRunner, type ShellRunner, IS_WIN } from "../platform.ts";

export interface HookContext {
  profile: Profile;
  fromId?: string | null;
  toId: string;
}

function buildEnv(ctx: HookContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  // REVIEW_8 M3 / Group E8：profile.env 先注入，DCH_* 后注入覆盖回权威值。旧顺序让用户
  // 在 profile.env 里写 DCH_PROFILE_ID=xxx 就能盖掉 hook 看到的真值（hook 内 echo $DCH_PROFILE_ID
  // 误以为是别的 profile）。新顺序保证 DCH_* 始终是切换语义本身的真相。
  if (ctx.profile.env) {
    for (const [k, v] of Object.entries(ctx.profile.env)) out[k] = v;
  }
  out.DCH_PROFILE_ID = ctx.profile.id;
  out.DCH_PROFILE_TOOL = ctx.profile.tool;
  out.DCH_PROFILE_CONFIG_DIR = expandHome(ctx.profile.configDir);
  out.DCH_SWITCH_TO = ctx.toId;
  if (ctx.fromId !== undefined && ctx.fromId !== null) {
    out.DCH_SWITCH_FROM = ctx.fromId;
  }
  return out;
}

/**
 * 根据 runner 选合适的 script 段：
 * - string 形式 → 直接用（按当前 runner 跑）
 * - object 形式 → 优先匹配当前 runner.kind，cmd / powershell 内部互为兜底（同 Win family）
 *   POSIX 严格只取 `posix` 字段，不 fallback 到 powershell/cmd（bash 跑不了那两类语法）
 *
 * 返回 null 视为「该平台无脚本」，runHook 直接返 null（与 script 为空字符串同语义）。
 */
export function pickScriptForRunner(s: HookScript, runner: ShellRunner): string | null {
  if (typeof s === "string") return s;
  switch (runner.kind) {
    case "powershell":
      return s.powershell ?? s.cmd ?? null;
    case "cmd":
      return s.cmd ?? s.powershell ?? null;
    case "bash":
      return s.posix ?? null;
  }
}

/**
 * REVIEW_8 M4 / Group C2：spawn hook 进 detach process group + timeout killpg 杀整组。
 *
 * 旧实现用 `proc.kill()` 只杀 direct child（bash），bash 已 exit 后 detach 孙子（如
 * `(sleep 30 &)`）仍持 stdio pipe FD → bun ReadableStream pump 永不 EOF → useProfile 永久卡死。
 * Rust 端 proc_timeout.rs 已经修过同款（setsid + killpg），TS 端落同样的修。
 *
 * Unix: `Bun.spawn({detached: true})` 让 bash 成为 session/group leader（pgid = bash.pid），
 *        timeout 时 `process.kill(-pid, SIGKILL)` 给整组发信号 → bash + 孙子全死。
 * Windows: detach 触发面窄（无 `(... &)` 语法）+ Bun 没有等价 process group API，fallback 走旧的
 *          `proc.kill()`（TerminateProcess 立即杀 direct child）。
 */
function killProcessGroup(proc: { pid: number | null; kill: () => void }): void {
  if (IS_WIN) {
    try { proc.kill(); } catch {}
    return;
  }
  const pid = proc.pid;
  if (pid != null) {
    try {
      // 负 pid 表示「整 process group」（POSIX kill(2) 语义）
      process.kill(-pid, "SIGKILL");
    } catch {
      // pgid 漂移 / 子已死 / 权限不足 — 兜底再 kill 一次 direct child
      try { proc.kill(); } catch {}
    }
  }
}

export async function runHook(
  hookName: "preSwitch" | "postSwitch",
  script: HookScript | undefined,
  ctx: HookContext,
  timeoutMs: number,
): Promise<HookResult | null> {
  if (script === undefined || script === null) return null;
  const runner = defaultShellRunner();
  const picked = pickScriptForRunner(script, runner);
  if (!picked || !picked.trim()) return null;

  const env = buildEnv(ctx);
  const start = Date.now();
  let timedOut = false;

  const proc = Bun.spawn([runner.cmd, ...runner.args(picked)], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    // REVIEW_8 M4：detach 让 bash 成为 process group leader，方便 timeout 时 killpg 杀整组
    // （含 detach 孙子持 stdio pipe FD 让 ReadableStream 永挂的场景）。
    detached: !IS_WIN,
  });

  const timer = setTimeout(() => {
    timedOut = true;
    // REVIEW_8 M4：原 `proc.kill()` 只杀 direct child（bash），改 killProcessGroup 杀整组。
    // 主进程 SIGTERM 可能被 `trap "" TERM` 屏蔽 → killpg SIGKILL 兜住。
    killProcessGroup(proc);
  }, timeoutMs);

  // Hard cap：timeoutMs + GRACE 后强制返回 truncated，不无限等 stdout drain。
  // 解决 H1：hook 脚本 detach 子进程（如 `(sleep 10 &); echo done; exit 0`）时，
  // 子进程继承 stdout pipe，主 bash exit 后 pipe 不 close，`new Response(proc.stdout).text()`
  // 永不 resolve → useProfile 永久卡死。GRACE 给 SIGTERM/SIGKILL 一点时间生效，
  // 之后强行 truncate。同样给 proc.exited 加上限避免 detach 场景 await 永挂。
  // M4 落地后：killpg 会让孙子持的 pipe FD 也关，drainAll 应该能在 grace 内自然 EOF —
  // hardCap 改成兜底（罕见 pgid 漂移 / killpg 失败时仍能返回）。
  const GRACE_MS = 500;
  const drainAll = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const truncatedFallback: [string, string] = ["[truncated by timeout]", "[truncated by timeout]"];
  const hardCap = new Promise<[string, string]>((resolve) =>
    setTimeout(() => resolve(truncatedFallback), timeoutMs + GRACE_MS),
  );
  const [stdout, stderr] = await Promise.race([drainAll, hardCap]);

  await Promise.race([
    proc.exited,
    new Promise<void>((r) => setTimeout(r, timeoutMs + GRACE_MS * 2)),
  ]);
  clearTimeout(timer);

  return {
    hook: hookName,
    exitCode: timedOut ? -1 : (proc.exitCode ?? -1),
    stdout,
    stderr,
    durationMs: Date.now() - start,
    timedOut,
  };
}
