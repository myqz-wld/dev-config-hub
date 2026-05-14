import { describe, expect, it } from "bun:test";
import { consumeRestoreResult, buildRestoreArgs, PartialRestoreError } from "./bridge-backup.ts";
import type { DchCommandResult } from "./bridge-core.ts";
import type { Manifest, ApplyBackupResult } from "../profiles/backup.ts";
import {
  decideAttemptClose,
  countFilledSecrets,
  shouldCommitReloadResponse,
  nextSecretsStateAfterIPC,
} from "./components/profile/restore-modal-helpers.ts";
import type { SecretLogicalEntry } from "./bridge.ts";

// **REVIEW_9 G12 / D-MED-3**: G5/G6 关键修法零测试覆盖问题修复 — 5 个 invariant test 集中。
// pure helper 直接测分支;非 pure 的 React state race / setState reset 通过抽 pure decide
// helper 测决策逻辑(component handler 仅做计算 + dispatch,不重 render component)。

// ─── 1. consumeRestoreResult (bridge-backup.ts) ────────────────────────────

const mockManifest = (): Manifest => ({
  format_version: 1,
  created_at: "2026-01-01T00:00:00Z",
  source_user: "u",
  source_host: "h",
  dch_version: "1.0.0",
  options: { no_placeholder: false, include_shared: true },
  profiles: [],
  shared: { dch_scripts: [], agents_paths: [] },
  placeholders: [],
} as unknown as Manifest);

const mockOk = (overrides?: Partial<DchCommandResult>): DchCommandResult => ({
  stdout: "",
  stderr: "",
  code: 0,
  truncated: false,
  ...overrides,
});

describe("consumeRestoreResult — partial restore / timeout / truncated 决策", () => {
  it("code=-2 → 抛超时错误,humanize timeout (300000ms → 5 分钟)", () => {
    const r = mockOk({ code: -2 });
    expect(() => consumeRestoreResult<ApplyBackupResult>(r, "300000")).toThrow(/超时|5 分钟/);
  });

  it("truncated=true → 抛截断错误,humanize timeout", () => {
    const r = mockOk({ truncated: true, code: 0, stdout: "{}" });
    expect(() => consumeRestoreResult<ApplyBackupResult>(r, "60000")).toThrow(/截断|1 分钟/);
  });

  it("code !== 0 + 完整 result JSON (含 manifest + errors + appliedProfiles + sharedActions) → PartialRestoreError", () => {
    const partialResult = {
      manifest: mockManifest(),
      errors: ["一个 profile 失败"],
      appliedProfiles: [{ originalId: "ok", finalId: "ok", configDir: "/x", conflict: "none" }],
      sharedActions: [],
      placeholders: [],
    };
    const r = mockOk({ code: 1, stdout: JSON.stringify(partialResult) });
    expect(() => consumeRestoreResult<ApplyBackupResult>(r, "60000")).toThrow(PartialRestoreError);
  });

  it("**REVIEW_9 D-LOW-2**: code !== 0 + result JSON 缺 appliedProfiles/sharedActions → 走 plain Error 不抛 TypeError", () => {
    const malformedPartial = {
      manifest: mockManifest(),
      errors: ["something failed"],
      // 缺 appliedProfiles / sharedActions array
    };
    const r = mockOk({ code: 1, stdout: JSON.stringify(malformedPartial) });
    expect(() => consumeRestoreResult<ApplyBackupResult>(r, "60000")).toThrow(/缺 appliedProfiles/);
    // 关键:不应抛 TypeError "Cannot read properties of undefined (reading 'length')"
    try {
      consumeRestoreResult<ApplyBackupResult>(r, "60000");
    } catch (e) {
      expect(e).not.toBeInstanceOf(TypeError);
      expect((e as Error).message).toContain("partial restore stdout 缺");
    }
  });

  it("code=0 + 完整 manifest result → 返 result(typed)", () => {
    const okResult = {
      manifest: mockManifest(),
      errors: [],
      appliedProfiles: [],
      sharedActions: [],
      placeholders: [],
    };
    const r = mockOk({ code: 0, stdout: JSON.stringify(okResult) });
    const got = consumeRestoreResult<ApplyBackupResult>(r, "60000");
    expect(got.manifest).toBeDefined();
    expect(got.errors).toEqual([]);
  });

  it("code=0 + 空 stdout → 抛 plain error", () => {
    const r = mockOk({ code: 0, stdout: "" });
    expect(() => consumeRestoreResult<ApplyBackupResult>(r, "60000")).toThrow(/返回空 stdout/);
  });

  it("code=0 + stdout 不含 manifest → 抛 plain error", () => {
    const r = mockOk({ code: 0, stdout: JSON.stringify({ ok: true }) });
    expect(() => consumeRestoreResult<ApplyBackupResult>(r, "60000")).toThrow(/缺 manifest 字段/);
  });
});

// ─── 2. buildRestoreArgs (bridge-backup.ts) ───────────────────────────────

describe("buildRestoreArgs — args 构造各 opts 组合", () => {
  it("无 opts → 仅核心 args(profile / restore / packFile / --yes / --json)", () => {
    expect(buildRestoreArgs("/path/x.dchpack", {})).toEqual([
      "profile", "restore", "/path/x.dchpack", "--yes", "--json",
    ]);
  });

  it("prefix → 追加 --prefix <value>", () => {
    expect(buildRestoreArgs("/p.dchpack", { prefix: "myprefix" })).toEqual([
      "profile", "restore", "/p.dchpack", "--yes", "--json",
      "--prefix", "myprefix",
    ]);
  });

  it("allowOriginalPath → 追加 --allow-original-path", () => {
    expect(buildRestoreArgs("/p.dchpack", { allowOriginalPath: true })).toEqual([
      "profile", "restore", "/p.dchpack", "--yes", "--json",
      "--allow-original-path",
    ]);
  });

  it("renameMap 单 key → 追加 --rename a=b", () => {
    expect(buildRestoreArgs("/p.dchpack", { renameMap: { "old": "new" } })).toEqual([
      "profile", "restore", "/p.dchpack", "--yes", "--json",
      "--rename", "old=new",
    ]);
  });

  it("renameMap 多 key → comma 拼接", () => {
    const args = buildRestoreArgs("/p.dchpack", { renameMap: { "a": "x", "b": "y" } });
    // 顺序按 Object.entries 插入序;断言 --rename flag 后 value 包含两个映射
    expect(args).toContain("--rename");
    const idx = args.indexOf("--rename");
    expect(args[idx + 1]).toContain("a=x");
    expect(args[idx + 1]).toContain("b=y");
  });

  it("空 renameMap → 不追加 --rename(避免空 value)", () => {
    expect(buildRestoreArgs("/p.dchpack", { renameMap: {} })).toEqual([
      "profile", "restore", "/p.dchpack", "--yes", "--json",
    ]);
  });

  it("全 opts 组合 → 顺序 prefix → allow-original-path → rename", () => {
    const args = buildRestoreArgs("/p.dchpack", {
      prefix: "pre",
      allowOriginalPath: true,
      renameMap: { "k": "v" },
    });
    expect(args).toEqual([
      "profile", "restore", "/p.dchpack", "--yes", "--json",
      "--prefix", "pre",
      "--allow-original-path",
      "--rename", "k=v",
    ]);
  });
});

// ─── 3. decideAttemptClose (RestoreBackupModal D-HIGH-2) ──────────────────

describe("decideAttemptClose — busy / phase / hasSecrets / filledCount 各分支", () => {
  it("busy=true → noop(任何情况下,防 setState on unmounted)", () => {
    expect(decideAttemptClose({ busy: true, phase: "rename", hasSecrets: false, filledCount: 0 })).toBe("noop");
    expect(decideAttemptClose({ busy: true, phase: "secrets", hasSecrets: true, filledCount: 5 })).toBe("noop");
  });

  it("phase=secrets + hasSecrets + filledCount > 0 → confirm(弹内联 confirm 防丢失)", () => {
    expect(decideAttemptClose({ busy: false, phase: "secrets", hasSecrets: true, filledCount: 1 })).toBe("confirm");
    expect(decideAttemptClose({ busy: false, phase: "secrets", hasSecrets: true, filledCount: 99 })).toBe("confirm");
  });

  it("phase=secrets + hasSecrets + filledCount === 0 → close(没填值无需 confirm)", () => {
    expect(decideAttemptClose({ busy: false, phase: "secrets", hasSecrets: true, filledCount: 0 })).toBe("close");
  });

  it("phase=secrets + hasSecrets=false → close(本不该到 secrets phase,边角)", () => {
    expect(decideAttemptClose({ busy: false, phase: "secrets", hasSecrets: false, filledCount: 0 })).toBe("close");
  });

  it("phase=rename → close(rename phase 无 secret 状态可丢失)", () => {
    expect(decideAttemptClose({ busy: false, phase: "rename", hasSecrets: false, filledCount: 0 })).toBe("close");
    expect(decideAttemptClose({ busy: false, phase: "rename", hasSecrets: true, filledCount: 5 })).toBe("close");
  });
});

describe("countFilledSecrets — skip 优先 / 空 value 不算", () => {
  const mkEntry = (name: string): SecretLogicalEntry => ({
    name, fieldName: name.replace(/-\d+$/, ""), count: 1,
    hint: "1 occurrence", locations: [],
  });
  const entries = [mkEntry("A-1"), mkEntry("B-1"), mkEntry("C-1")];

  it("全空 → 0", () => {
    expect(countFilledSecrets(entries, { secretsMap: {}, skipMap: {} })).toBe(0);
  });

  it("部分填值 → 计数", () => {
    expect(countFilledSecrets(entries, {
      secretsMap: { "A-1": "x", "B-1": "y" }, skipMap: {},
    })).toBe(2);
  });

  it("skip 优先(skip + value 不算 filled)", () => {
    expect(countFilledSecrets(entries, {
      secretsMap: { "A-1": "x" }, skipMap: { "A-1": true },
    })).toBe(0);
  });

  it("空字符串 value 不算 filled", () => {
    expect(countFilledSecrets(entries, {
      secretsMap: { "A-1": "", "B-1": "y" }, skipMap: {},
    })).toBe(1);
  });
});

// ─── 4. shouldCommitReloadResponse (BackupHistoryModal D-MED-5) ───────────

describe("shouldCommitReloadResponse — reload race resolution invariant", () => {
  it("myId === currentId(本次 reload 是 latest)→ commit", () => {
    expect(shouldCommitReloadResponse({ myId: 5, currentId: 5 })).toBe(true);
  });

  it("myId < currentId(本 reload 已被新 reload 取代)→ 丢弃", () => {
    expect(shouldCommitReloadResponse({ myId: 3, currentId: 5 })).toBe(false);
  });

  it("myId > currentId(理论不该发生,防御性)→ 丢弃", () => {
    // currentId 永远 ++ 单调递增,myId > currentId 表示 currentId 时光倒流 = bug;
    // shouldCommitReloadResponse 用严格相等仅 commit latest,不 commit"未来"id
    expect(shouldCommitReloadResponse({ myId: 7, currentId: 5 })).toBe(false);
  });

  it("初始 myId=1 + currentId=1 → commit(第一次 reload)", () => {
    expect(shouldCommitReloadResponse({ myId: 1, currentId: 1 })).toBe(true);
  });
});

// ─── 5. nextSecretsStateAfterIPC (RestoreBackupModal D-MED-1) ─────────────

describe("nextSecretsStateAfterIPC — secret state hygiene reset", () => {
  it("永远返新 empty state(secretsMap + skipMap 都空对象)", () => {
    const r = nextSecretsStateAfterIPC();
    expect(r.secretsMap).toEqual({});
    expect(r.skipMap).toEqual({});
  });

  it("两次调用返不同对象 ref(防 React state 误判 same instance 跳过 re-render)", () => {
    const a = nextSecretsStateAfterIPC();
    const b = nextSecretsStateAfterIPC();
    expect(a).not.toBe(b);
    expect(a.secretsMap).not.toBe(b.secretsMap);
    expect(a.skipMap).not.toBe(b.skipMap);
  });

  it("返值是 empty 而非 undefined / null(防 React state TypeError)", () => {
    const r = nextSecretsStateAfterIPC();
    expect(r).not.toBeNull();
    expect(r).toBeDefined();
    expect(typeof r.secretsMap).toBe("object");
    expect(typeof r.skipMap).toBe("object");
  });
});
