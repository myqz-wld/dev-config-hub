import { describe, expect, it } from "bun:test";
import { sep } from "node:path";
import { collapseHome, expandHome, HOME } from "./store.ts";

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
