import type { Profile, HookResult } from "./types.ts";
import { expandHome } from "./store.ts";

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

export async function runHook(
  hookName: "preSwitch" | "postSwitch",
  script: string | undefined,
  ctx: HookContext,
  timeoutMs: number,
): Promise<HookResult | null> {
  if (!script || !script.trim()) return null;
  const env = buildEnv(ctx);
  const start = Date.now();
  let timedOut = false;

  const proc = Bun.spawn(["bash", "-lc", script], {
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
