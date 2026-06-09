import { describe, expect, it } from "bun:test";
import {
  buildSecretsIndex,
  parseFieldPath,
  setByFieldPath,
} from "./secrets-index.ts";
import type { PlaceholderEntry } from "./backup.ts";
import { redactJsonContent, redactTomlContent, makePlaceholder } from "./redact.ts";

// ─── REVIEW_9 G1 fix 覆盖测试 ─────────────────────────────────────────

describe("REVIEW_9 A-HIGH-1: parseDotPath / parseFieldPath 识别 key[i] 段(TOML array-of-tables 可逆)", () => {
  it("TOML dot-path 含 [i] 拆出 key + index 混排", () => {
    const r = parseFieldPath("servers[0].api_key");
    expect(r.kind).toBe("toml");
    expect(r.segments).toEqual([
      { type: "key", key: "servers" },
      { type: "index", index: 0 },
      { type: "key", key: "api_key" },
    ]);
  });

  it("TOML 多层数组 a[0][1] 也支持", () => {
    const r = parseFieldPath("matrix[0][1]");
    expect(r.kind).toBe("toml");
    expect(r.segments).toEqual([
      { type: "key", key: "matrix" },
      { type: "index", index: 0 },
      { type: "index", index: 1 },
    ]);
  });

  it("旧 TOML dot-path 无 [i] 仍兼容(纯 key)", () => {
    const r = parseFieldPath("a.b.c");
    expect(r.kind).toBe("toml");
    expect(r.segments).toEqual([
      { type: "key", key: "a" },
      { type: "key", key: "b" },
      { type: "key", key: "c" },
    ]);
  });

  it("TOML array-of-tables fill round-trip(setByFieldPath set 进 array 里的 key)", () => {
    const data: Record<string, unknown> = {
      servers: [
        { name: "alpha", api_key: "PLACEHOLDER" },
        { name: "beta", api_key: "PLACEHOLDER" },
      ],
    };
    const pf = parseFieldPath("servers[0].api_key");
    const ok = setByFieldPath(data, pf.segments, "real-key-1");
    expect(ok).toBe(true);
    expect((data.servers as Array<Record<string, string>>)[0]!.api_key).toBe("real-key-1");
    expect((data.servers as Array<Record<string, string>>)[1]!.api_key).toBe("PLACEHOLDER");
  });
});

describe("REVIEW_9 A-codex M2: parseFieldPath 识别 backslash 转义 key", () => {
  it("escape `\\.` 表字面 `.` 当单段 key", () => {
    const r = parseFieldPath("$.api\\.key");
    expect(r.kind).toBe("json");
    expect(r.segments).toEqual([{ type: "key", key: "api.key" }]);
  });

  it("escape `\\[` 表字面 `[` 当单段 key", () => {
    const r = parseFieldPath("$.weird\\[name");
    expect(r.kind).toBe("json");
    expect(r.segments).toEqual([{ type: "key", key: "weird[name" }]);
  });

  it("escape `\\\\` 表字面 backslash", () => {
    const r = parseFieldPath("$.path\\\\sep");
    expect(r.kind).toBe("json");
    expect(r.segments).toEqual([{ type: "key", key: "path\\sep" }]);
  });

  it("escape 与 normal 混合", () => {
    const r = parseFieldPath("$.config.api\\.key.value");
    expect(r.segments).toEqual([
      { type: "key", key: "config" },
      { type: "key", key: "api.key" },
      { type: "key", key: "value" },
    ]);
  });
});

describe("REVIEW_9 A-HIGH-2 / B-HIGH-2 跨批: broken JSON / TOML parse fallback regex", () => {
  it("broken JSONC(// comment)→ 走 plain-text regex 兜底,sk-ant-... 真凭据被脱敏", () => {
    // 不是合法 JSON(JSONC // 注释)
    const broken = '// comment\n{"api_key": "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA"}';
    const r = redactJsonContent(broken, "settings.json");
    // parse 失败 fall back regex,真凭据应被脱敏
    expect(r.content).not.toContain("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA");
    expect(r.content).toContain("<<DCH_PLACEHOLDER:ANTHROPIC_API_KEY>>");
    // 留 warning 让 caller 透传到 manifest.security_warnings
    expect(r.warnings).toBeDefined();
    expect(r.warnings!.length).toBeGreaterThan(0);
    expect(r.warnings![0]).toContain("settings.json");
  });

  it("broken TOML(missing quote)→ 走 plain-text regex 兜底,ghp_... 真凭据被脱敏", () => {
    const broken = 'name = "alpha\napi_key = ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
    const r = redactTomlContent(broken, "config.toml");
    expect(r.content).not.toContain("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
    expect(r.placeholders.length).toBeGreaterThan(0);
    expect(r.warnings).toBeDefined();
    expect(r.warnings![0]).toContain("config.toml");
  });

  it("broken JSON 内含 KEY: VALUE YAML-like → KEY_VALUE pattern 命中保留分隔符", () => {
    // .json 文件其实写的是 YAML(typo)→ parse 失败 fall back 后,KEY: VALUE 命中
    const broken = "---\napi_key: \"sk-ant-api03-XYZXYZXYZXYZXYZXYZXYZ\"\n";
    const r = redactJsonContent(broken, "stash.json");
    expect(r.content).not.toContain("sk-ant-api03-XYZXYZXYZXYZXYZXYZXYZ");
    // KEY_VALUE 重写后保留 `:` 分隔符 + 引号(不再强转 `=`)
    expect(r.content).toMatch(/api_key:\s*"<<DCH_PLACEHOLDER:/);
    expect(r.warnings).toBeDefined();
  });
});

describe("REVIEW_9 A-HIGH-3: shortHash empty value 不参与 dedup", () => {
  it("空 string value 仍命中 sensitive key 但 valueHash undefined", () => {
    const r = redactJsonContent(JSON.stringify({ api_key: "" }));
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]!.valueHash).toBeUndefined();
  });

  it("buildSecretsIndex: 多个空 value 跨 fieldName / 跨 file → 各自独立 logical key 不被错误合并", () => {
    // 旧 bug: shortHash("")="e3b0c44298fc1c14"被当合法 hash → 全部空 value 误合并成同一 group
    // 跨 fieldName fan-out 时把 group primary fieldName 错填给所有空字段(数据破坏)
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/p1/configDir/.mcp.json", fieldPath: "$.api_key", fieldName: "api_key", hint: "" },
      { packPath: "profiles/p2/configDir/.mcp.json", fieldPath: "$.token", fieldName: "token", hint: "" },
      { packPath: "profiles/p3/configDir/.mcp.json", fieldPath: "$.secret", fieldName: "secret", hint: "" },
    ];
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>([
      [placeholders[0]!, undefined], // valueHash undefined(空 value)
      [placeholders[1]!, undefined],
      [placeholders[2]!, undefined],
    ]);
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    // 每条独立 logical key,不被 cross-fieldName 合并
    expect(idx.entries).toHaveLength(3);
    expect(idx.entries.every((e) => e.count === 1)).toBe(true);
    expect(idx.total_occurrences).toBe(3);
  });
});

describe("REVIEW_9 e2e round-trip: walkAndRedact escape → parseFieldPath → setByFieldPath 闭环", () => {
  it("JSON key 含 `.` 字面量(命中 token 子串): redact + fill round-trip", () => {
    // key `my.token` 含 sensitive `token` 子串 + 含 `.` 字面量(罕见但合法 JSON)
    const original = JSON.stringify({ "my.token": "sk-real-secret-token" });
    const r = redactJsonContent(original);
    // walkAndRedact 把 key escape 后拼成 `$.my\.token`
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]!.fieldPath).toBe("$.my\\.token");
    expect(r.placeholders[0]!.fieldName).toBe("my.token"); // 原始 key 名,UI 显示用

    // fill 阶段反向 parseFieldPath 还原成单段 key + setByFieldPath 写回
    const parsed = JSON.parse(r.content);
    expect(parsed["my.token"]).toBe(makePlaceholder("my.token"));
    const pf = parseFieldPath(r.placeholders[0]!.fieldPath);
    expect(pf.segments).toEqual([{ type: "key", key: "my.token" }]);
    const ok = setByFieldPath(parsed, pf.segments, "filled-back");
    expect(ok).toBe(true);
    expect(parsed["my.token"]).toBe("filled-back");
  });

  it("JSON 嵌套 key 含 `[`(极罕见): parseFieldPath escape 处理正确", () => {
    const original = JSON.stringify({ config: { "weird[name": "secret-value-here" } });
    // weird[name 不命中 sensitive 关键字 → 不脱敏 → 直接验证 parseFieldPath escape 处理正确
    const data = JSON.parse(original);
    const pf = parseFieldPath("$.config.weird\\[name");
    expect(pf.segments).toEqual([
      { type: "key", key: "config" },
      { type: "key", key: "weird[name" },
    ]);
    const ok = setByFieldPath(data, pf.segments, "new-value");
    expect(ok).toBe(true);
    expect(data.config["weird[name"]).toBe("new-value");
  });
});

describe("REVIEW_9 A-MED-1: parseFieldPath 识别 JSON 根数组 `$[i]...`", () => {
  it("`$[0]` 单独 → JSON 模式 + index 段", () => {
    const r = parseFieldPath("$[0]");
    expect(r.kind).toBe("json");
    expect(r.segments).toEqual([{ type: "index", index: 0 }]);
  });

  it("`$[0].name` → JSON 模式 + index + key 混排", () => {
    const r = parseFieldPath("$[0].name");
    expect(r.kind).toBe("json");
    expect(r.segments).toEqual([
      { type: "index", index: 0 },
      { type: "key", key: "name" },
    ]);
  });

  it("`$[0].api_key` setByFieldPath 能命中 JSON 根数组里的 sensitive 字段", () => {
    const data = [{ name: "alpha", api_key: "<<DCH_PLACEHOLDER:api_key>>" }];
    const pf = parseFieldPath("$[0].api_key");
    expect(setByFieldPath(data, pf.segments, "real-key-A")).toBe(true);
    expect(data[0]!.api_key).toBe("real-key-A");
  });

  it("`$[1][0].token` 嵌套数组 → 双 index + key 段", () => {
    const r = parseFieldPath("$[1][0].token");
    expect(r.kind).toBe("json");
    expect(r.segments).toEqual([
      { type: "index", index: 1 },
      { type: "index", index: 0 },
      { type: "key", key: "token" },
    ]);
  });
});

describe("REVIEW_9 A-INFO-1: parsePathTokens 空 segment 抛 Error 而非静默吞", () => {
  it("`$.a..b` 中段空 → throw", () => {
    expect(() => parseFieldPath("$.a..b")).toThrow(/empty key segment/);
  });

  it("`$..a` leading 空 → throw", () => {
    expect(() => parseFieldPath("$..a")).toThrow(/empty key segment/);
  });

  it("`a..b` TOML 形式中段空 → throw", () => {
    expect(() => parseFieldPath("a..b")).toThrow(/empty key segment/);
  });

  it("`a.b.` trailing `.` 不报错(尾部点不产生空段,接受 typo)", () => {
    // tokenizer 在最后一个 `.` 时 i++ 后退出循环,不进入 buf 收集 → 不抛
    const r = parseFieldPath("a.b.");
    expect(r.segments).toEqual([
      { type: "key", key: "a" },
      { type: "key", key: "b" },
    ]);
  });
});
