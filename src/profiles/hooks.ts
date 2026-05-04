import type { Profile, HookResult, HookScript } from "./types.ts";
import { expandHome } from "./store.ts";
import { defaultShellRunner, type ShellRunner } from "../platform.ts";

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
  out.DCH_PROFILE_ID = ctx.profile.id;
  out.DCH_PROFILE_TOOL = ctx.profile.tool;
  out.DCH_PROFILE_CONFIG_DIR = expandHome(ctx.profile.configDir);
  out.DCH_SWITCH_TO = ctx.toId;
  if (ctx.fromId !== undefined && ctx.fromId !== null) {
    out.DCH_SWITCH_FROM = ctx.fromId;
  }
  if (ctx.profile.env) {
    for (const [k, v] of Object.entries(ctx.profile.env)) out[k] = v;
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
  });

  const timer = setTimeout(() => {
    timedOut = true;
    // 主进程 SIGTERM 可能被 `trap "" TERM` 屏蔽 → 后续硬截断兜住
    try { proc.kill(); } catch {}
  }, timeoutMs);

  // Hard cap：timeoutMs + GRACE 后强制返回 truncated，不无限等 stdout drain。
  // 解决 H1：hook 脚本 detach 子进程（如 `(sleep 10 &); echo done; exit 0`）时，
  // 子进程继承 stdout pipe，主 bash exit 后 pipe 不 close，`new Response(proc.stdout).text()`
  // 永不 resolve → useProfile 永久卡死。GRACE 给 SIGTERM/SIGKILL 一点时间生效，
  // 之后强行 truncate。同样给 proc.exited 加上限避免 detach 场景 await 永挂。
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
