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
      expect(store.version).toBe(1);
      expect(store.profiles).toEqual([]);
      expect(store.active).toEqual({ claude: null, codex: null });
      expect(store.preferences.hookTimeoutMs).toBe(30_000);
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

  it("缺 active 字段 → fallback {claude: null, codex: null}", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-loadstore-"));
    try {
      const path = join(tmp, "profiles.json");
      await writeFile(path, JSON.stringify({ version: 1, profiles: [] }), "utf8");
      const store = await loadStore(path);
      expect(store.active).toEqual({ claude: null, codex: null });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("缺 preferences 字段 → fallback DEFAULT_PREFERENCES", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-loadstore-"));
    try {
      const path = join(tmp, "profiles.json");
      await writeFile(path, JSON.stringify({ version: 1, profiles: [] }), "utf8");
      const store = await loadStore(path);
      expect(store.preferences.hookTimeoutMs).toBe(30_000);
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
      expect(store.active).toEqual({ claude: "a-1", codex: null });
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
        version: 1,
        profiles: [{
          id: "test-claude",
          tool: "claude",
          configDir: "~/.claude-test",
          env: { K: "v" },
        }],
        active: { claude: "test-claude", codex: null },
        preferences: { hookTimeoutMs: 5_000 },
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
        version: 1, profiles: [], active: { claude: null, codex: null },
        preferences: { hookTimeoutMs: 30_000 },
      };
      await saveStore(empty, path);
      const loaded = await loadStore(path);
      expect(loaded.profiles).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// H3 lost update 回归测：spawn 5 child 各自 load → push → save。当前无锁实现会丢更新；
// PR-5 加文件锁后此 test 应改 toEqual(6)。先 skip 保留预期形式，PR-5 时反 skip 验通。
describe("concurrent saveStore (H3 — 待 PR-5 修复)", () => {
  it.skip("5 个并发 child 各 push 1 profile，期望最终 6 条", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-concurrent-"));
    try {
      const path = join(tmp, "profiles.json");
      const init: ProfileStore = {
        version: 1,
        profiles: [{ id: "init", tool: "claude", configDir: "~/.x" }],
        active: { claude: null, codex: null },
        preferences: { hookTimeoutMs: 30_000 },
      };
      await saveStore(init, path);

      const childScript = `
        const { loadStore, saveStore } = await import("${process.cwd()}/src/profiles/store.ts");
        const path = ${JSON.stringify(path)};
        const s = await loadStore(path);
        s.profiles.push({ id: "child-" + process.pid, tool: "claude", configDir: "~/.x" + process.pid });
        await new Promise(r => setTimeout(r, 50));
        await saveStore(s, path);
      `;
      const procs = Array.from({ length: 5 }, () =>
        Bun.spawn(["bun", "-e", childScript], { stdout: "pipe", stderr: "pipe" }),
      );
      await Promise.all(procs.map((p) => p.exited));

      const final = await loadStore(path);
      expect(final.profiles.length).toBe(6); // 当前实测 ~2，PR-5 修复后应通
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
