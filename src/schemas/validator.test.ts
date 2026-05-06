import { describe, expect, it } from "bun:test";
import { validate } from "./validator.ts";
import { CLAUDE_SETTINGS } from "./claude-settings.ts";
import { DCH_STORE } from "./dch-store.ts";

describe("validate (ajv runtime)", () => {
  it("空 object → 0 错误（顶层 additionalProperties: true 接受空）", () => {
    expect(validate(CLAUDE_SETTINGS, {})).toEqual([]);
  });

  it("合法字段 → 0 错误", () => {
    expect(validate(CLAUDE_SETTINGS, {
      model: "claude-opus-4-7",
      fastMode: true,
      cleanupPeriodDays: 30,
    })).toEqual([]);
  });

  it("effortLevel 非 enum → 错误", () => {
    const errs = validate(CLAUDE_SETTINGS, { effortLevel: "ultra" });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.path).toBe("effortLevel");
    expect(errs[0]!.message).toMatch(/allowed values|enum/);
  });

  it("cleanupPeriodDays < 1 → 错误（min: 1）", () => {
    const errs = validate(CLAUDE_SETTINGS, { cleanupPeriodDays: 0 });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.path).toBe("cleanupPeriodDays");
    expect(errs[0]!.message).toMatch(/>= 1|minimum/);
  });

  it("type 错误（model 应是 string）", () => {
    const errs = validate(CLAUDE_SETTINGS, { model: 42 });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.path).toBe("model");
  });

  it("env keyPattern 校验：合法 KEY → 0 错误", () => {
    expect(validate(CLAUDE_SETTINGS, {
      env: { HTTP_PROXY: "http://x", FOO_BAR: "y" },
    })).toEqual([]);
  });

  it("REVIEW_4 R_2 R-H2 修：env lowercase key 不再 ajv 报错（与上游 schema 一致），UI 层 KVMapField 红框守门", () => {
    // 之前 H2' fix 让 ajv 严过上游标红 lowercase env；R-H2 回退后 ajv 不报，UI 层 KVMapField onBlur keyPattern 不命中显红框 + manager.ts ENV_KEY_RE CLI 守门
    expect(validate(CLAUDE_SETTINGS, {
      env: { http_proxy: "http://x", "with-dash": "y" },
    })).toEqual([]);
  });

  it("未知顶层 key → 0 错误（additionalProperties: true）", () => {
    expect(validate(CLAUDE_SETTINGS, { my_custom_field: "anything" })).toEqual([]);
  });

  it("Diagnostic.path 格式：嵌套 + 数组下标", () => {
    const errs = validate(CLAUDE_SETTINGS, {
      permissions: { defaultMode: "invalid_mode" },
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.path).toBe("permissions.defaultMode");
  });

  it("dch-store version 必须 = 1", () => {
    const errs = validate(DCH_STORE, { version: 2, profiles: [], active: {}, preferences: { hookTimeoutMs: 30000 } });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("dch-store profile.tool 必须 enum claude/codex", () => {
    const errs = validate(DCH_STORE, {
      version: 1,
      profiles: [{ id: "x", tool: "invalid", configDir: "~/x" }],
      active: {},
      preferences: { hookTimeoutMs: 30000 },
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => e.path.includes("profiles.0.tool"))).toBe(true);
  });

  it("validator 缓存：同 toolSchema 调两次返同一 errors 引用语义", () => {
    const e1 = validate(CLAUDE_SETTINGS, { effortLevel: "x" });
    const e2 = validate(CLAUDE_SETTINGS, { effortLevel: "x" });
    expect(e1).toEqual(e2);
  });
});
