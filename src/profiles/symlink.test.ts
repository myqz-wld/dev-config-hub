import { describe, expect, it } from "bun:test";
import { resolve as pathResolve, join } from "node:path";
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { getSymlinkType, normalizeSymlinkTarget, pathState } from "./symlink.ts";

describe("getSymlinkType", () => {
  it("Win → 'junction'", () => {
    expect(getSymlinkType("win32")).toBe("junction");
  });

  it("macOS → undefined（fs.symlink 默认）", () => {
    expect(getSymlinkType("darwin")).toBeUndefined();
  });

  it("Linux → undefined", () => {
    expect(getSymlinkType("linux")).toBeUndefined();
  });

  it("默认参数走当前平台", () => {
    const expected = process.platform === "win32" ? "junction" : undefined;
    expect(getSymlinkType()).toBe(expected);
  });
});

describe("normalizeSymlinkTarget", () => {
  it("Win 强制绝对路径（junction 要求 absolute target）", () => {
    // pathResolve 在 mac 上会按 POSIX 规则展开，但断言「非原样返回」即可
    const out = normalizeSymlinkTarget("foo/bar", "win32");
    // 只验证：在 win32 模式下不会原样返回相对路径
    expect(out).not.toBe("foo/bar");
    expect(out).toBe(pathResolve("foo/bar"));
  });

  it("Win 绝对路径原样（resolve 是幂等）", () => {
    const abs = pathResolve("/tmp/x"); // 在 mac 上是 /tmp/x；Win 上是 C:\tmp\x
    expect(normalizeSymlinkTarget(abs, "win32")).toBe(abs);
  });

  it("POSIX passthrough", () => {
    expect(normalizeSymlinkTarget("/tmp/foo", "darwin")).toBe("/tmp/foo");
    expect(normalizeSymlinkTarget("relative", "linux")).toBe("relative");
  });
});

// REVIEW_2 PR-1: pathState 四态 — initToolDir / switchSymlink 决策核心，无 spec 易回退。
// 用 tmpdir 隔离不动 ~/.claude / ~/.codex；symlink.ts TOOL_PATHS 是 const 不便注入，
// 这里直接对 pathState 纯函数测，覆盖核心 invariant。
describe("pathState (REVIEW_2 PR-1 回归保护)", () => {
  it("missing：路径不存在 → 'missing'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-pathstate-"));
    try {
      expect(await pathState(join(tmp, "nonexistent"))).toBe("missing");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("file：普通文件 → 'file'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-pathstate-"));
    try {
      const f = join(tmp, "regular.txt");
      await writeFile(f, "hello", "utf8");
      expect(await pathState(f)).toBe("file");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("directory：真实目录 → 'directory'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-pathstate-"));
    try {
      const d = join(tmp, "subdir");
      await mkdir(d, { recursive: true });
      expect(await pathState(d)).toBe("directory");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("symlink：指向目录的 symlink → 'symlink'（不返回 target 类型）", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-pathstate-"));
    try {
      const target = join(tmp, "target-dir");
      const link = join(tmp, "link");
      await mkdir(target);
      // mac/linux 直接 symlink，Win 用 junction
      const type = process.platform === "win32" ? "junction" : undefined;
      await symlink(target, link, type);
      // pathState 用 lstat 不 follow，所以指向目录也返 symlink 而非 directory
      expect(await pathState(link)).toBe("symlink");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("symlink：指向文件的 symlink → 'symlink'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-pathstate-"));
    try {
      const target = join(tmp, "target.txt");
      const link = join(tmp, "link.txt");
      await writeFile(target, "data", "utf8");
      await symlink(target, link);
      expect(await pathState(link)).toBe("symlink");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("symlink：dangling symlink（target 不存在）→ 'symlink'", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "dch-pathstate-"));
    try {
      const link = join(tmp, "dangling");
      await symlink(join(tmp, "nonexistent"), link);
      // lstat 不解析 target，dangling symlink 仍返 symlink
      expect(await pathState(link)).toBe("symlink");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
