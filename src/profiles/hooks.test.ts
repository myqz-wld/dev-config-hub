import { test, expect, describe } from "bun:test";
import { runHook, type HookContext } from "./hooks.ts";
import type { Profile } from "./types.ts";

const baseProfile: Profile = {
  id: "test-profile",
  tool: "claude",
  configDir: "~/.claude-test",
  env: { ANTHROPIC_API_KEY: "sk-test-fake" },
};

const ctx: HookContext = {
  profile: baseProfile,
  fromId: "claude-default",
  toId: "test-profile",
};

describe("runHook", () => {
  test("returns null when script is undefined", async () => {
    const r = await runHook("preSwitch", undefined, ctx, 5000);
    expect(r).toBeNull();
  });

  test("returns null when script is empty string", async () => {
    const r = await runHook("preSwitch", "   ", ctx, 5000);
    expect(r).toBeNull();
  });

  test("captures stdout from successful script", async () => {
    const r = await runHook("preSwitch", "echo hello", ctx, 5000);
    expect(r).not.toBeNull();
    expect(r!.exitCode).toBe(0);
    expect(r!.stdout.trim()).toBe("hello");
    expect(r!.timedOut).toBe(false);
  });

  test("non-zero exit code is preserved", async () => {
    const r = await runHook("postSwitch", "exit 42", ctx, 5000);
    expect(r!.exitCode).toBe(42);
    expect(r!.timedOut).toBe(false);
  });

  test("captures stderr separately", async () => {
    const r = await runHook("preSwitch", "echo oops 1>&2; exit 1", ctx, 5000);
    expect(r!.exitCode).toBe(1);
    expect(r!.stderr.trim()).toBe("oops");
  });

  test("injects DCH_* env vars", async () => {
    const script = `
      echo "id=$DCH_PROFILE_ID"
      echo "tool=$DCH_PROFILE_TOOL"
      echo "to=$DCH_SWITCH_TO"
      echo "from=$DCH_SWITCH_FROM"
      echo "dir=$DCH_PROFILE_CONFIG_DIR"
    `;
    const r = await runHook("preSwitch", script, ctx, 5000);
    expect(r!.exitCode).toBe(0);
    expect(r!.stdout).toContain("id=test-profile");
    expect(r!.stdout).toContain("tool=claude");
    expect(r!.stdout).toContain("to=test-profile");
    expect(r!.stdout).toContain("from=claude-default");
    // configDir 应被 expand 成绝对路径
    expect(r!.stdout).toMatch(/dir=\/.+\/\.claude-test/);
  });

  test("injects profile.env into hook environment", async () => {
    const r = await runHook("preSwitch", `echo "k=$ANTHROPIC_API_KEY"`, ctx, 5000);
    expect(r!.stdout.trim()).toBe("k=sk-test-fake");
  });

  test("omits DCH_SWITCH_FROM when fromId is null", async () => {
    const localCtx: HookContext = { ...ctx, fromId: null };
    const r = await runHook("preSwitch", `echo "from=[$DCH_SWITCH_FROM]"`, localCtx, 5000);
    expect(r!.stdout.trim()).toBe("from=[]");
  });

  test("times out and reports timedOut=true", async () => {
    const r = await runHook("preSwitch", "sleep 5", ctx, 200);
    expect(r!.timedOut).toBe(true);
    expect(r!.exitCode).toBe(-1);
    expect(r!.durationMs).toBeLessThan(2000);
  });
});
