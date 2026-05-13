import { describe, expect, it } from "bun:test";

// CHANGELOG_15: 测纯函数 buildProfileData，避开 mock @tauri-apps/api/core 的 IPC mock
// （bun mock.module 跨 file 污染：App.test.tsx mock 了 ./bridge.ts 让其他 file import
// 拿到 stub，不能在这里 mock invoke 间接测真 bridge.ts 函数）。
import { buildProfileData } from "./bridge.ts";

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
