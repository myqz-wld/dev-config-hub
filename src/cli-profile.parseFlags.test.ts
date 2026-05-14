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

  it("VALUE_FLAGS 集合内容固定（9 项：5 个 profile flag + 4 个 backup flag）", () => {
    expect(VALUE_FLAGS.size).toBe(9);
    // profile add 系列
    expect(VALUE_FLAGS.has("dir")).toBe(true);
    expect(VALUE_FLAGS.has("desc")).toBe(true);
    expect(VALUE_FLAGS.has("from")).toBe(true);
    expect(VALUE_FLAGS.has("pre-hook")).toBe(true);
    expect(VALUE_FLAGS.has("post-hook")).toBe(true);
    // backup / restore 系列（CHANGELOG_16 + CHANGELOG_17 加入）
    expect(VALUE_FLAGS.has("out")).toBe(true);
    expect(VALUE_FLAGS.has("profiles")).toBe(true);
    expect(VALUE_FLAGS.has("prefix")).toBe(true);
    expect(VALUE_FLAGS.has("rename")).toBe(true);
  });

  it("VALUE_FLAGS 末尾缺 value → throw（REVIEW_8 M11/B6 升级 LOW→ERR）", () => {
    // REVIEW_8 升级：旧实现静默变 boolean true 让 backup --out 写到 undefined / cmdAdd --pre-hook
    // 缺 hook 内容这种沉默错误难定位。现在直接 throw，外层 main().catch 在 json 模式 jsonOut 错。
    expect(() => parseFlags(["--pre-hook"])).toThrow(/--pre-hook 需要 value/);
    expect(() => parseFlags(["claude", "id", "--dir"])).toThrow(/--dir 需要 value/);
  });

  it("--env 缺 = → throw（REVIEW_8 M11/B6）", () => {
    expect(() => parseFlags(["--env", "BADFORMAT"])).toThrow(/KEY=VALUE/);
  });

  it("--env 缺 value → throw（REVIEW_8 M11/B6 — 旧 falsy guard 漏判）", () => {
    expect(() => parseFlags(["--env"])).toThrow(/缺 value/);
  });

  it("allowedFlags 设置 → 未知 flag throw（REVIEW_8 M11/B6 防 typo）", () => {
    const allowed = new Set(["dir", "from", "desc", "pre-hook", "post-hook"]);
    // 典型 typo: --no-share vs --no-shared（虽然不在 add 集合，借此演示）
    expect(() => parseFlags(["--unknown"], { allowedFlags: allowed })).toThrow(/未知 flag --unknown/);
    expect(() => parseFlags(["--no-share"], { allowedFlags: new Set(["no-shared", "yes"]) }))
      .toThrow(/未知 flag --no-share/);
  });

  it("allowedFlags 不设 → 未知 flag 仍宽松收下（保后向兼容）", () => {
    const r = parseFlags(["--xyz", "value"]);
    expect(r.flags.xyz).toBe("value");
  });

  it("allowedFlags + 已知 flag → OK", () => {
    const allowed = new Set(["dir", "from", "desc", "pre-hook", "post-hook"]);
    const r = parseFlags(["claude", "id", "--dir", "/tmp", "--desc", "x"], { allowedFlags: allowed });
    expect(r.flags.dir).toBe("/tmp");
    expect(r.flags.desc).toBe("x");
  });
});
