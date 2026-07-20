import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyStoreDefaults, EMPTY_STORE } from "./store-shape.ts";
import { loadStore } from "./store.ts";

// CHANGELOG_15: applyStoreDefaults 是 store.ts.loadStore 与 bridge.ts.loadProfileDataDirect
// 共享的纯函数。两套调用路径必须输出一致，否则未来给 preferences 加新字段时一边改一边忘改 →
// CLI 落盘正常但 UI 显示 undefined（或反之）。本组测试锁同源契约。

describe("applyStoreDefaults — pure default 补全", () => {
  it("空对象 → EMPTY_STORE 等价 shape", () => {
    expect(applyStoreDefaults({})).toEqual(EMPTY_STORE);
  });

  it("null → EMPTY_STORE", () => {
    expect(applyStoreDefaults(null)).toEqual(EMPTY_STORE);
  });

  it("undefined → EMPTY_STORE", () => {
    expect(applyStoreDefaults(undefined)).toEqual(EMPTY_STORE);
  });

  it("缺其他工具 active → 补 null（不丢失已有 active.claude）", () => {
    const r = applyStoreDefaults({ active: { claude: "claude-prod" } });
    expect(r.active).toEqual({
      claude: "claude-prod",
      codex: null,
      grok: null,
      cursor: null,
    });
  });

  it("缺 preferences → 补 hookTimeoutMs=30000", () => {
    const r = applyStoreDefaults({ profiles: [], active: {} });
    expect(r.preferences.hookTimeoutMs).toBe(30_000);
  });

  it("preferences 部分残缺 → 默认补全", () => {
    const r = applyStoreDefaults({ preferences: {} });
    expect(r.preferences.hookTimeoutMs).toBe(30_000);
  });

  it("自定义 hookTimeoutMs 保留", () => {
    const r = applyStoreDefaults({ preferences: { hookTimeoutMs: 60_000 } });
    expect(r.preferences.hookTimeoutMs).toBe(60_000);
  });

  it("profiles 数组保留", () => {
    const profiles = [
      { id: "p1", tool: "claude" as const, configDir: "~/.claude-p1" },
    ];
    const r = applyStoreDefaults({ profiles });
    expect(r.profiles).toEqual(profiles);
  });

  it("version 强制 1（防 raw 写入旧 version 漂移）", () => {
    const r = applyStoreDefaults({ version: 999 });
    expect(r.version).toBe(1);
  });
});

describe("loadStore ≡ applyStoreDefaults(JSON.parse(raw)) — 双路径同源", () => {
  it("真实 fs 路径与 pure 路径输出一致", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dch-store-shape-"));
    const path = join(dir, "profiles.json");
    const raw = {
      profiles: [{ id: "demo", tool: "claude", configDir: "~/.claude-demo" }],
      active: { claude: "demo" },
      preferences: { hookTimeoutMs: 45_000 },
    };
    await writeFile(path, JSON.stringify(raw, null, 2), "utf8");

    const fromFs = await loadStore(path);
    const fromPure = applyStoreDefaults(raw);
    expect(fromFs).toEqual(fromPure);

    await rm(dir, { recursive: true, force: true });
  });

  it("不存在文件 → loadStore 回 structuredClone(EMPTY_STORE)，与 applyStoreDefaults({}) 等价", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dch-store-shape-"));
    const path = join(dir, "missing.json");

    const fromFs = await loadStore(path);
    const fromPure = applyStoreDefaults({});
    expect(fromFs).toEqual(fromPure);

    await rm(dir, { recursive: true, force: true });
  });

  it("loadStore 返 structuredClone（mutation 不污染 EMPTY_STORE）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dch-store-shape-"));
    const path = join(dir, "missing.json");
    const r = await loadStore(path);
    r.profiles.push({ id: "x", tool: "claude", configDir: "/tmp" });
    expect(EMPTY_STORE.profiles).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });
});
