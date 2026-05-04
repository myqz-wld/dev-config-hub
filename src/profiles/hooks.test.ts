import { test, expect, describe } from "bun:test";
import { runHook, pickScriptForRunner, type HookContext } from "./hooks.ts";
import type { Profile } from "./types.ts";
import { defaultShellRunner, IS_WIN } from "../platform.ts";

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

describe("runHook (string 形式 — 向后兼容)", () => {
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
    // bash echo to stderr / PowerShell Write-Error 不一致；用平台兼容写法
    const script = IS_WIN
      ? `[Console]::Error.WriteLine('oops'); exit 1`
      : `echo oops 1>&2; exit 1`;
    const r = await runHook("preSwitch", script, ctx, 5000);
    expect(r!.exitCode).toBe(1);
    expect(r!.stderr.trim()).toBe("oops");
  });

  test("injects DCH_* env vars", async () => {
    // Win PowerShell 用 $env:VAR；POSIX 用 $VAR
    const script = IS_WIN
      ? `Write-Output "id=$env:DCH_PROFILE_ID"
Write-Output "tool=$env:DCH_PROFILE_TOOL"
Write-Output "to=$env:DCH_SWITCH_TO"
Write-Output "from=$env:DCH_SWITCH_FROM"
Write-Output "dir=$env:DCH_PROFILE_CONFIG_DIR"`
      : `
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
    expect(r!.stdout).toMatch(/dir=.+[\\/]\.claude-test/);
  });

  test("injects profile.env into hook environment", async () => {
    const script = IS_WIN
      ? `Write-Output "k=$env:ANTHROPIC_API_KEY"`
      : `echo "k=$ANTHROPIC_API_KEY"`;
    const r = await runHook("preSwitch", script, ctx, 5000);
    expect(r!.stdout.trim()).toBe("k=sk-test-fake");
  });

  test("omits DCH_SWITCH_FROM when fromId is null", async () => {
    const localCtx: HookContext = { ...ctx, fromId: null };
    const script = IS_WIN
      ? `Write-Output "from=[$env:DCH_SWITCH_FROM]"`
      : `echo "from=[$DCH_SWITCH_FROM]"`;
    const r = await runHook("preSwitch", script, localCtx, 5000);
    expect(r!.stdout.trim()).toBe("from=[]");
  });

  test("times out and reports timedOut=true", async () => {
    // POSIX sleep；Win Start-Sleep
    const script = IS_WIN ? `Start-Sleep -Seconds 5` : "sleep 5";
    const r = await runHook("preSwitch", script, ctx, 200);
    expect(r!.timedOut).toBe(true);
    expect(r!.exitCode).toBe(-1);
    expect(r!.durationMs).toBeLessThan(2000);
  });

  // REVIEW_2 PR-3 (#H1)：detach 子进程持 stdout pipe，主 bash exit 后 pipe 不 close
  // → 旧版 `new Response(proc.stdout).text()` 永不 resolve → useProfile 卡死 N 秒。
  // 修复：runHook 加 hardCap 强制 truncate + proc.exited race 限时。
  // POSIX-only：PowerShell 没等价的 detach `(...; &)` 语法，Win 路径暂不测。
  test.skipIf(IS_WIN)("detach 子进程 (sleep 10 &) 不阻塞 useProfile（H1 回归保护）", async () => {
    // 主 bash exit 0 但 sleep 10 子进程持 stdout fd，pipe 永不 close
    const script = `(sleep 10 &); echo immediate; exit 0`;
    const start = Date.now();
    const r = await runHook("preSwitch", script, ctx, 500);
    const elapsed = Date.now() - start;
    expect(r).not.toBeNull();
    // hardCap 在 timeoutMs + 500 触发，proc.exited race 在 timeoutMs + 1000 触发
    // 总耗时应 ≤ ~2000ms（PR-3 之前实测 ≥ 10000ms）
    expect(elapsed).toBeLessThan(2500);
    expect(r!.timedOut).toBe(true);
    expect(r!.exitCode).toBe(-1);
    // 输出可能被 truncate（detach 子进程持 fd），也可能拿到 "immediate\n" 然后 truncate
    // 关键 invariant：runHook 必须返回，不卡住
  });
});

describe("pickScriptForRunner (object 形式 — 平台分流)", () => {
  test("string 形式直接 passthrough", () => {
    expect(pickScriptForRunner("echo hi", { cmd: "bash", args: () => [], kind: "bash" })).toBe("echo hi");
    expect(pickScriptForRunner("echo hi", { cmd: "ps", args: () => [], kind: "powershell" })).toBe("echo hi");
  });

  test("powershell runner 优先取 powershell 字段，回退 cmd", () => {
    const r = { cmd: "ps", args: () => [], kind: "powershell" as const };
    expect(pickScriptForRunner({ powershell: "P", cmd: "C" }, r)).toBe("P");
    expect(pickScriptForRunner({ cmd: "C" }, r)).toBe("C");
    expect(pickScriptForRunner({ posix: "X" }, r)).toBeNull();
  });

  test("cmd runner 优先取 cmd 字段，回退 powershell", () => {
    const r = { cmd: "cmd", args: () => [], kind: "cmd" as const };
    expect(pickScriptForRunner({ powershell: "P", cmd: "C" }, r)).toBe("C");
    expect(pickScriptForRunner({ powershell: "P" }, r)).toBe("P");
  });

  test("bash runner 严格只取 posix 字段", () => {
    const r = { cmd: "bash", args: () => [], kind: "bash" as const };
    expect(pickScriptForRunner({ posix: "B", powershell: "P" }, r)).toBe("B");
    expect(pickScriptForRunner({ powershell: "P" }, r)).toBeNull();
  });

  test("空 object → null", () => {
    expect(pickScriptForRunner({}, defaultShellRunner())).toBeNull();
  });
});

describe("runHook (object 形式)", () => {
  test("仅当前平台字段时正常跑", async () => {
    const script = IS_WIN ? { powershell: `Write-Output 'win-only'` } : { posix: `echo posix-only` };
    const r = await runHook("preSwitch", script, ctx, 5000);
    expect(r).not.toBeNull();
    expect(r!.exitCode).toBe(0);
    expect(r!.stdout.trim()).toBe(IS_WIN ? "win-only" : "posix-only");
  });

  test("非当前平台字段 → 返回 null（视为该平台未提供）", async () => {
    const script = IS_WIN ? { posix: "echo posix" } : { powershell: "Write-Output 'ps'" };
    const r = await runHook("preSwitch", script, ctx, 5000);
    expect(r).toBeNull();
  });

  test("空 object → null", async () => {
    const r = await runHook("preSwitch", {}, ctx, 5000);
    expect(r).toBeNull();
  });

  test("两边都设 → 选当前平台对应那一个", async () => {
    const script = {
      posix: `echo "from-posix"`,
      powershell: `Write-Output "from-ps"`,
    };
    const r = await runHook("preSwitch", script, ctx, 5000);
    expect(r).not.toBeNull();
    expect(r!.stdout.trim()).toBe(IS_WIN ? "from-ps" : "from-posix");
  });
});

