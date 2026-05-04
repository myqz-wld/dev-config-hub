import { describe, expect, it } from "bun:test";
import { parseFlags, VALUE_FLAGS } from "./cli-profile.ts";

// REVIEW_2 PR-1：CHANGELOG_5 反复修过 parseFlags / VALUE_FLAGS（--pre-hook '--foo' 字面值
// 被吞过，等等），但一直无 spec。本文件 lock 当前正确行为防回退。
// 注意：parseFlags 内部对「--env BADFORMAT」走 err() → process.exit(1)；本测试不触发该路径
// （要测时需 spawn child + capture exit code），下面只测 happy + edge 不挂的场景。

describe("parseFlags (REVIEW_2 PR-1 回归保护)", () => {
  it("空 argv → 全空", () => {
    const r = parseFlags([]);
    expect(r.positional).toEqual([]);
    expect(r.flags).toEqual({});
    expect(r.envPairs).toEqual([]);
  });

  it("纯 positional", () => {
    const r = parseFlags(["claude", "my-id"]);
    expect(r.positional).toEqual(["claude", "my-id"]);
    expect(r.flags).toEqual({});
  });

  it("VALUE_FLAGS：--dir <path>", () => {
    const r = parseFlags(["claude", "id", "--dir", "/tmp/foo"]);
    expect(r.positional).toEqual(["claude", "id"]);
    expect(r.flags).toEqual({ dir: "/tmp/foo" });
  });

  it("VALUE_FLAGS：--pre-hook '--foo' 字面值保留（CHANGELOG_5 修复点回归）", () => {
    // 关键：VALUE_FLAGS 白名单让 --pre-hook 不再用 startsWith('--') 误判，
    // 字面值 `--foo` 被收为 hook 内容，不被当作 boolean flag 吞掉
    const r = parseFlags(["claude", "id", "--pre-hook", "--foo bar baz"]);
    expect(r.flags["pre-hook"]).toBe("--foo bar baz");
  });

  it("VALUE_FLAGS：--post-hook 后跟单 --flag", () => {
    const r = parseFlags(["--post-hook", "--abort"]);
    expect(r.flags["post-hook"]).toBe("--abort");
  });

  it("VALUE_FLAGS：--from <id>", () => {
    const r = parseFlags(["--from", "claude-pro"]);
    expect(r.flags.from).toBe("claude-pro");
  });

  it("VALUE_FLAGS：--desc <text>", () => {
    const r = parseFlags(["--desc", "my description"]);
    expect(r.flags.desc).toBe("my description");
  });

  it("非 VALUE_FLAGS：--yes 是 boolean", () => {
    const r = parseFlags(["--yes"]);
    expect(r.flags.yes).toBe(true);
  });

  it("非 VALUE_FLAGS：--json 后跟另一 flag → 都是 boolean", () => {
    const r = parseFlags(["--json", "--yes"]);
    expect(r.flags.json).toBe(true);
    expect(r.flags.yes).toBe(true);
  });

  it("非 VALUE_FLAGS：--xxx 后跟非 flag value 仍被吃为 value（不在白名单的 flag 也允许带值）", () => {
    const r = parseFlags(["--unknown", "value"]);
    expect(r.flags.unknown).toBe("value");
  });

  it("--env KEY=VALUE", () => {
    const r = parseFlags(["--env", "FOO=bar"]);
    expect(r.envPairs).toEqual([["FOO", "bar"]]);
    expect(r.flags.env).toBeUndefined();
  });

  it("--env 多对 + 与 positional 混合", () => {
    const r = parseFlags([
      "claude", "id",
      "--env", "K1=v1",
      "--dir", "/tmp",
      "--env", "K2=v2",
    ]);
    expect(r.positional).toEqual(["claude", "id"]);
    expect(r.envPairs).toEqual([["K1", "v1"], ["K2", "v2"]]);
    expect(r.flags.dir).toBe("/tmp");
  });

  it("--env value 含 = 号 → 仅按第一个 = 切（API key 等场景）", () => {
    const r = parseFlags(["--env", "TOKEN=abc=def=ghi"]);
    expect(r.envPairs).toEqual([["TOKEN", "abc=def=ghi"]]);
  });

  it("--env value 为空（KEY=）也允许", () => {
    const r = parseFlags(["--env", "FOO="]);
    expect(r.envPairs).toEqual([["FOO", ""]]);
  });

  it("VALUE_FLAGS 集合内容固定（5 项）", () => {
    expect(VALUE_FLAGS.size).toBe(5);
    expect(VALUE_FLAGS.has("dir")).toBe(true);
    expect(VALUE_FLAGS.has("desc")).toBe(true);
    expect(VALUE_FLAGS.has("from")).toBe(true);
    expect(VALUE_FLAGS.has("pre-hook")).toBe(true);
    expect(VALUE_FLAGS.has("post-hook")).toBe(true);
  });

  it("VALUE_FLAGS 末尾缺 value → 静默变 boolean true（已知 LOW，REVIEW_2 R1-L5/R2-L1）", () => {
    // 此为 lock 当前行为：未来若加 missing-value 报错，需把 expect 改成 toThrow
    const r = parseFlags(["--pre-hook"]);
    expect(r.flags["pre-hook"]).toBe(true);
  });
});
