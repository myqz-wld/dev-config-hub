import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyStoreDefaults, EMPTY_STORE } from "./store-shape.ts";
import { loadStore } from "./store.ts";

// applyStoreDefaults 是 store.ts.loadStore 与 bridge.ts.loadProfileDataDirect 共享的
// 迁移入口。两套调用路径必须输出一致，尤其不能让旧全局超时从其中一条路径漏进方案。

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

  it("旧全局超时被忽略，方案缺值直接补 30000", () => {
    const r = applyStoreDefaults({
      profiles: [{ id: "p1", tool: "claude", configDir: "~/.claude-p1" }],
      preferences: { hookTimeoutMs: 60_000 },
    });
    expect(r.profiles[0]?.hookTimeoutMs).toBe(30_000);
    expect("preferences" in r).toBeFalse();
  });

  it("方案自己的合法超时保留，非法值回落 30000", () => {
    const profiles = [
      { id: "p1", tool: "claude" as const, configDir: "~/.claude-p1", hookTimeoutMs: 45_000 },
      { id: "p2", tool: "codex" as const, configDir: "~/.codex-p2", hookTimeoutMs: 42 },
    ];
    const r = applyStoreDefaults({ profiles });
    expect(r.profiles.map((p) => p.hookTimeoutMs)).toEqual([45_000, 30_000]);
  });

  it("version 强制 2（防 raw 写入旧 version 漂移）", () => {
    const r = applyStoreDefaults({ version: 999 });
    expect(r.version).toBe(2);
  });

  it("缺 backup → 补空工具级规则；已有脚本开关保留", () => {
    expect(applyStoreDefaults({}).backup).toEqual({ toolPolicies: {} });
    expect(applyStoreDefaults({
      backup: { toolPolicies: {}, scriptsEnabled: false },
    }).backup.scriptsEnabled).toBeFalse();
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
