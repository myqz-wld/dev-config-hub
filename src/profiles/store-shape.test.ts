import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyStoreDefaults, EMPTY_STORE } from "./store-shape.ts";
import { loadStore, saveStore } from "./store.ts";
import type { ProfileStore } from "./types.ts";

describe("current profile-store shape", () => {
  it("fills current v2 defaults", () => {
    expect(applyStoreDefaults({ version: 2 })).toEqual(EMPTY_STORE);
    const r = applyStoreDefaults({ version: 2, active: { claude: "work", obsolete: "x" } });
    expect(r.active).toEqual({ claude: "work", codex: null, grok: null, cursor: null });
  });

  it.each([null, undefined, {}, { version: 1 }, { version: 3 }, { version: "2" }])(
    "rejects unsupported or missing versions: %j", (raw) => {
      expect(() => applyStoreDefaults(raw)).toThrow(/仅支持 version: 2/);
    },
  );

  it("drops obsolete fields while retaining profile env and both hook forms", () => {
    const raw = {
      version: 2,
      profiles: [{
        id: "work", tool: "claude", configDir: "~/.claude-work",
        env: { DEMO_TOKEN: "synthetic-value" }, description: "work", isDefault: true,
        hooks: { preSwitch: "echo before", postSwitch: { posix: "echo after", powershell: "Write-Output after" } },
        hookTimeoutMs: 45_000, backupPolicy: { schemaVersion: 1 }, obsolete: true,
      }],
      active: { claude: "work" },
      backup: { toolPolicies: {}, scriptsEnabled: false },
      preferences: { hookTimeoutMs: 60_000 },
    };
    const r = applyStoreDefaults(raw);
    expect(Object.keys(r)).toEqual(["version", "profiles", "active"]);
    expect(r.profiles[0]).toEqual({
      id: "work", tool: "claude", configDir: "~/.claude-work", env: raw.profiles[0]!.env,
      description: "work", isDefault: true, hooks: raw.profiles[0]!.hooks, hookTimeoutMs: 45_000,
    });
    expect(raw.profiles[0]).toHaveProperty("backupPolicy");
  });

  it.each([undefined, 42, -1, 600_001, "45000"])("invalid timeout %j defaults to 30s", (timeout) => {
    const r = applyStoreDefaults({
      version: 2,
      profiles: [{ id: "work", tool: "claude", configDir: "~/.claude-work", hookTimeoutMs: timeout }],
    });
    expect(r.profiles[0]?.hookTimeoutMs).toBe(30_000);
  });
});

describe("store IO uses the same version contract", () => {
  it("rejects v1 reads and saves without rewriting the source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dch-store-version-"));
    try {
      const path = join(dir, "profiles.json");
      const old = { version: 1, profiles: [], active: {} };
      const original = JSON.stringify(old);
      await writeFile(path, original);
      await expect(loadStore(path)).rejects.toThrow(/仅支持 version: 2/);
      await expect(saveStore(old as unknown as ProfileStore, path)).rejects.toThrow(/仅支持 version: 2/);
      expect(await Bun.file(path).text()).toBe(original);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("missing stores return independent defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dch-store-missing-"));
    try {
      const path = join(dir, "missing.json");
      const store = await loadStore(path);
      expect(store).toEqual(EMPTY_STORE);
      store.active.claude = "test";
      store.profiles.push({ id: "test", tool: "claude", configDir: "~/.test" });
      expect(await loadStore(path)).toEqual(EMPTY_STORE);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
