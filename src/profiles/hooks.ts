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
    try { proc.kill(); } catch {}
  }, timeoutMs);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
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
