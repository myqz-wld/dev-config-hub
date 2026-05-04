import { describe, expect, it } from "bun:test";
import { resolve as pathResolve } from "node:path";
import { getSymlinkType, normalizeSymlinkTarget } from "./symlink.ts";

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
