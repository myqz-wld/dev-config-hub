import { describe, expect, it } from "bun:test";
import { sep, join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { collapseHome, expandHome, HOME, loadStore, saveStore } from "./store.ts";
import type { ProfileStore } from "./types.ts";

describe("expandHome", () => {
  it("'~' → HOME", () => {
    expect(expandHome("~")).toBe(HOME);
  });

  it("'~/foo' → HOME/foo", () => {
    expect(expandHome("~/foo")).toBe(`${HOME}${sep}foo`);
  });

  it("绝对路径原样返回", () => {
    const abs = sep === "\\" ? "C:\\tmp\\foo" : "/tmp/foo";
    expect(expandHome(abs)).toBe(abs);
  });

  it("非 ~ 开头的字符串原样返回", () => {
    expect(expandHome("foo/bar")).toBe("foo/bar");
  });
});

describe("collapseHome", () => {
  it("HOME 本身 → '~'", () => {
    expect(collapseHome(HOME)).toBe("~");
  });

  it("HOME 子路径 → '~/...'", () => {
    expect(collapseHome(`${HOME}${sep}foo`)).toBe("~/foo");
    expect(collapseHome(`${HOME}${sep}.claude${sep}settings.json`)).toBe(
      "~/.claude/settings.json",
    );
  });

  it("不在 HOME 下的绝对路径原样返回", () => {
    const outside = sep === "\\" ? "C:\\tmp\\foo" : "/tmp/foo";
    expect(collapseHome(outside)).toBe(outside);
  });

  it("collapseHome + expandHome 往返一致", () => {
    const orig = `${HOME}${sep}.codex${sep}config.toml`;
    const collapsed = collapseHome(orig);
    expect(collapsed).toBe("~/.codex/config.toml");
    const expanded = expandHome(collapsed);
    expect(expanded).toBe(orig);
  });
});

// REVIEW_2 PR-1: loadStore / saveStore 边界 — 覆盖 H3 (lost update) + L 系列回归保护。
// 用 tmpdir 隔离不污染 ~/.dch/profiles.json；store.ts 的 path 参数正是为此而开。
describe("loadStore (tmpdir 隔离)", () => {
  it("文件不存在 → 返 EMPTY_STORE 深拷贝", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-loadstore-"));
    try {
      const path = join(tmp, "profiles.json");
      const store = await loadStore(path);
      expect(store.version).toBe(2);
      expect(store.profiles).toEqual([]);
      expect(store.active).toEqual({ claude: null, codex: null, grok: null, cursor: null });
      expect(store.backup).toEqual({ toolPolicies: {} });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("corrupt JSON → throw 含 path", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-loadstore-"));
    try {
      const path = join(tmp, "profiles.json");
      await writeFile(path, "{ not valid json", "utf8");
      await expect(loadStore(path)).rejects.toThrow(/无法解析.*profiles\.json/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("空文件 / 0 字节 → throw（与 corrupt 同语义）", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-loadstore-"));
    try {
      const path = join(tmp, "profiles.json");
      await writeFile(path, "", "utf8");
      await expect(loadStore(path)).rejects.toThrow(/无法解析/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("缺 active 字段 → fallback 所有工具 null", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-loadstore-"));
    try {
      const path = join(tmp, "profiles.json");
      await writeFile(path, JSON.stringify({ version: 1, profiles: [] }), "utf8");
      const store = await loadStore(path);
      expect(store.active).toEqual({ claude: null, codex: null, grok: null, cursor: null });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("旧 preferences 被忽略，方案缺超时直接补 30000", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-loadstore-"));
    try {
      const path = join(tmp, "profiles.json");
      await writeFile(path, JSON.stringify({
        version: 1,
        profiles: [{ id: "p", tool: "claude", configDir: "~/.p" }],
        preferences: { hookTimeoutMs: 600_000 },
      }), "utf8");
      const store = await loadStore(path);
      expect(store.profiles[0]?.hookTimeoutMs).toBe(30_000);
      expect("preferences" in store).toBeFalse();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("active 部分提供 → 与 default 合并", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-loadstore-"));
    try {
      const path = join(tmp, "profiles.json");
      await writeFile(path, JSON.stringify({ version: 1, profiles: [], active: { claude: "a-1" } }), "utf8");
      const store = await loadStore(path);
      expect(store.active).toEqual({ claude: "a-1", codex: null, grok: null, cursor: null });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("saveStore + loadStore roundtrip", () => {
  it("写入后读回保持一致", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-roundtrip-"));
    try {
      const path = join(tmp, "profiles.json");
      const original: ProfileStore = {
        version: 2,
        profiles: [{
          id: "test-claude",
          tool: "claude",
          configDir: "~/.claude-test",
          env: { K: "v" },
          hookTimeoutMs: 5_000,
        }],
        active: { claude: "test-claude", codex: null, grok: null, cursor: null },
        backup: { toolPolicies: {} },
      };
      await saveStore(original, path);
      const loaded = await loadStore(path);
      expect(loaded).toEqual(original);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("saveStore 自动 mkdir parent dir（深路径）", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-mkdir-"));
    try {
      const path = join(tmp, "deep", "nested", "dir", "profiles.json");
      const empty: ProfileStore = {
        version: 2, profiles: [], active: { claude: null, codex: null, grok: null, cursor: null },
        backup: { toolPolicies: {} },
      };
      await saveStore(empty, path);
      const loaded = await loadStore(path);
      expect(loaded.profiles).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("保存旧 shape 时升级 v2 并清理 preferences，不迁移旧超时", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-migrate-store-"));
    try {
      const path = join(tmp, "profiles.json");
      const legacy = {
        version: 1,
        profiles: [{ id: "legacy", tool: "claude", configDir: "~/.legacy" }],
        active: { claude: "legacy" },
        preferences: { hookTimeoutMs: 222_000 },
      };
      await saveStore(legacy as unknown as ProfileStore, path);
      const raw = JSON.parse(await Bun.file(path).text()) as Record<string, unknown>;
      expect(raw.version).toBe(2);
      expect(raw.preferences).toBeUndefined();
      expect((raw.profiles as Array<Record<string, unknown>>)[0]?.hookTimeoutMs).toBe(30_000);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// H3 lost update 回归测：spawn 5 child 各自 load → push → save。PR-5 加文件锁后通过。
describe("concurrent saveStore (H3 — PR-5 文件锁修复)", () => {
  it("5 个并发 child 各 push 1 profile 全部保留（文件锁 + retry）", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-concurrent-"));
    try {
      const path = join(tmp, "profiles.json");
      const lockPath = path + ".lock";
      const init: ProfileStore = {
        version: 2,
        profiles: [{ id: "init", tool: "claude", configDir: "~/.x" }],
        active: { claude: null, codex: null },
        backup: { toolPolicies: {} },
      };
      await saveStore(init, path);

      const repoRoot = process.cwd();
      const childScript = `
        const { loadStore, saveStore, withStoreLock } = await import(${JSON.stringify(repoRoot + "/src/profiles/store.ts")});
        const path = ${JSON.stringify(path)};
        const lockPath = ${JSON.stringify(lockPath)};
        await withStoreLock(lockPath, async () => {
          const s = await loadStore(path);
          s.profiles.push({ id: "child-" + process.pid, tool: "claude", configDir: "~/.x" + process.pid });
          await new Promise(r => setTimeout(r, 30));
          await saveStore(s, path);
        }, { maxWaitMs: 5000, staleMs: 10000 });
      `;
      const procs = Array.from({ length: 5 }, () =>
        Bun.spawn(["bun", "-e", childScript], { stdout: "pipe", stderr: "pipe" }),
      );
      const results = await Promise.all(procs.map((p) => p.exited));
      // 全部 child 应正常退出（no lock timeout）
      for (const code of results) expect(code).toBe(0);

      const final = await loadStore(path);
      expect(final.profiles.length).toBe(6); // init + 5 child push 全部保留
      const ids = final.profiles.map((p) => p.id);
      expect(ids).toContain("init");
      expect(ids.filter((id) => id.startsWith("child-")).length).toBe(5);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 15000); // 5 child × ~30ms 串行 + lock retry，宽限 15s
});
