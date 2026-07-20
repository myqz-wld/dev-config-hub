import { describe, it, expect } from "bun:test";
import { ENV_KEY_RE, validateEnv, validateTool } from "./manager.ts";

// REVIEW_2 PR-6 (#M5)：addProfile / updateProfile 上游 env key 校验回归保护。
// validateEnv 是纯函数 — 不触及 store / 文件锁，可以独立单测不污染 ~/.dch/profiles.json。
describe("ENV_KEY_RE / validateEnv (PR-6 #M5 上游守口)", () => {
  it("ENV_KEY_RE 接受合法 key", () => {
    expect(ENV_KEY_RE.test("FOO")).toBe(true);
    expect(ENV_KEY_RE.test("ANTHROPIC_API_KEY")).toBe(true);
    expect(ENV_KEY_RE.test("_underscore_start")).toBe(true);
    expect(ENV_KEY_RE.test("X1Y2Z3")).toBe(true);
    expect(ENV_KEY_RE.test("a_b_c")).toBe(true);
  });

  it("ENV_KEY_RE 拒绝非法 key", () => {
    expect(ENV_KEY_RE.test("MY KEY")).toBe(false); // 空格
    expect(ENV_KEY_RE.test("1FOO")).toBe(false); // 数字开头
    expect(ENV_KEY_RE.test("K-K")).toBe(false); // 连字符
    expect(ENV_KEY_RE.test("FOO=BAR")).toBe(false); // 等号
    expect(ENV_KEY_RE.test("")).toBe(false); // 空
    expect(ENV_KEY_RE.test("FOO\n")).toBe(false); // 换行
    expect(ENV_KEY_RE.test("FOO.BAR")).toBe(false); // 点
  });

  it("validateEnv: undefined / 空对象 → 不抛", () => {
    expect(() => validateEnv(undefined)).not.toThrow();
    expect(() => validateEnv({})).not.toThrow();
  });

  it("validateEnv: 全合法 → 不抛", () => {
    expect(() => validateEnv({ FOO: "bar", ANTHROPIC_API_KEY: "sk-...", _X: "" })).not.toThrow();
  });

  it("validateEnv: 任一非法 → throw 含 key", () => {
    expect(() => validateEnv({ "MY KEY": "v" })).toThrow(/MY KEY/);
    expect(() => validateEnv({ "1FOO": "v" })).toThrow(/1FOO/);
    expect(() => validateEnv({ "K-K": "v" })).toThrow(/K-K/);
  });

  it("validateEnv: 一堆合法中混一个非法也 throw", () => {
    expect(() => validateEnv({ A: "1", B: "2", "C D": "3", E: "4" })).toThrow(/C D/);
  });
});

describe("validateTool", () => {
  it.each(["claude", "codex", "grok", "cursor"])("accepts %s", (tool) => {
    expect(() => validateTool(tool)).not.toThrow();
  });

  it("rejects unknown tools from raw stores/backups", () => {
    expect(() => validateTool("project-tool")).toThrow(/非法 tool/);
  });
});
