import { describe, expect, it } from "bun:test";

// CHANGELOG_15: 测纯函数 buildProfileData，避开 mock @tauri-apps/api/core 的 IPC mock
// （bun mock.module 跨 file 污染：App.test.tsx mock 了 ./bridge.ts 让其他 file import
// 拿到 stub，不能在这里 mock invoke 间接测真 bridge.ts 函数）。
// REVIEW_8 H7 / Group E1：classifySaveError 也是 pure，同款规避路径。
import {
  buildProfileData,
  classifySaveError,
  MtimeMismatchError,
  MtimeMissingError,
} from "./bridge.ts";

describe("buildProfileData — pure shape composer (替代 dch list+current)", () => {
  it("storeContent=null（profiles.json 不存在）→ EMPTY_STORE shape + active 全 null", () => {
    const r = buildProfileData(null, { claude: null, codex: null });
    expect(r.store.profiles).toEqual([]);
    expect(r.store.active).toEqual({ claude: null, codex: null });
    expect(r.store.preferences.hookTimeoutMs).toBe(30_000);
    expect(r.active.claude).toEqual({ id: null, symlinkTarget: null });
    expect(r.active.codex).toEqual({ id: null, symlinkTarget: null });
  });

  it("有 store + 有 link target → 完整 shape 一致", () => {
    const raw = JSON.stringify({
      profiles: [
        { id: "claude-prod", tool: "claude", configDir: "~/.claude-prod" },
        { id: "codex-dev", tool: "codex", configDir: "~/.codex-dev" },
      ],
      active: { claude: "claude-prod", codex: "codex-dev" },
      preferences: { hookTimeoutMs: 45_000 },
    });
    const r = buildProfileData(raw, {
      claude: "/Users/test/.claude-prod",
      codex: "/Users/test/.codex-dev",
    });
    expect(r.store.profiles).toHaveLength(2);
    expect(r.store.preferences.hookTimeoutMs).toBe(45_000);
    expect(r.active).toEqual({
      claude: { id: "claude-prod", symlinkTarget: "/Users/test/.claude-prod" },
      codex: { id: "codex-dev", symlinkTarget: "/Users/test/.codex-dev" },
    });
  });

  it("link 全 null（symlink 不存在 / 非 symlink）→ active.symlinkTarget = null", () => {
    const raw = JSON.stringify({ active: { claude: "p1" } });
    const r = buildProfileData(raw, { claude: null, codex: null });
    expect(r.active.claude.id).toBe("p1");
    expect(r.active.claude.symlinkTarget).toBeNull();
    expect(r.active.codex.symlinkTarget).toBeNull();
  });

  it("坏 JSON → throw（caller silent catch 走 console.warn）", () => {
    expect(() =>
      buildProfileData("{not valid json", { claude: null, codex: null }),
    ).toThrow(/无法解析/);
  });

  it("store.active 缺 codex → buildProfileData 补 null（不 fallthrough 到旧 active）", () => {
    const raw = JSON.stringify({ active: { claude: "p1" } });
    const r = buildProfileData(raw, {
      claude: "/Users/test/.claude-p1",
      codex: "/Users/test/.codex-stale", // link 还在但 store 没记 → id 仍然 null
    });
    expect(r.active.codex.id).toBeNull();
    expect(r.active.codex.symlinkTarget).toBe("/Users/test/.codex-stale");
  });
});

describe("classifySaveError (REVIEW_8 H7 / Group E1) — Tauri invoke error 分类", () => {
  it("MTIME_MISMATCH:<exp>:<act> → MtimeMismatchError(expected, actual)", () => {
    const e = classifySaveError(new Error("MTIME_MISMATCH:1234567:2345678"));
    expect(e).toBeInstanceOf(MtimeMismatchError);
    const me = e as MtimeMismatchError;
    expect(me.expectedMtimeUs).toBe(1234567);
    expect(me.actualMtimeUs).toBe(2345678);
    expect(me.name).toBe("MtimeMismatchError");
    expect(me.message).toContain("文件已被外部修改");
  });

  it("MTIME_MISSING:<exp> → MtimeMissingError(expected)", () => {
    const e = classifySaveError(new Error("MTIME_MISSING:9999"));
    expect(e).toBeInstanceOf(MtimeMissingError);
    const me = e as MtimeMissingError;
    expect(me.expectedMtimeUs).toBe(9999);
    expect(me.name).toBe("MtimeMissingError");
    expect(me.message).toContain("文件已被删除");
  });

  it("其他错误前缀（路径越界 / IO 错） → 透传原始 Error", () => {
    const orig = new Error("拒绝写非 HOME 路径: /etc/passwd");
    const e = classifySaveError(orig);
    expect(e).toBe(orig); // 同一引用透传
    expect(e).not.toBeInstanceOf(MtimeMismatchError);
    expect(e).not.toBeInstanceOf(MtimeMissingError);
  });

  it("非 Error 抛入（string） → 包装为 Error 且不归类为 mtime 错", () => {
    const e = classifySaveError("plain string err");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("plain string err");
    expect(e).not.toBeInstanceOf(MtimeMismatchError);
  });

  it("MTIME_MISMATCH 嵌入更长 wrapper string 也能解析", () => {
    // Tauri 端 worker 失败时可能拼 "save_file_if_mtime worker failed: MTIME_MISMATCH:1:2"
    const e = classifySaveError(new Error("save_file_if_mtime worker failed: MTIME_MISMATCH:111:222"));
    expect(e).toBeInstanceOf(MtimeMismatchError);
    expect((e as MtimeMismatchError).expectedMtimeUs).toBe(111);
    expect((e as MtimeMismatchError).actualMtimeUs).toBe(222);
  });

  it("MTIME_MISMATCH 中嵌入非数字（罕见 Rust panic 场景） → 不识别，透传", () => {
    const orig = new Error("MTIME_MISMATCH:abc:def");
    const e = classifySaveError(orig);
    expect(e).toBe(orig);
    expect(e).not.toBeInstanceOf(MtimeMismatchError);
  });
});
