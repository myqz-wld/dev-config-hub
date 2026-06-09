import { describe, expect, it } from "bun:test";
import {
  buildSecretsIndex,
  parseFieldPath,
  setByFieldPath,
} from "./secrets-index.ts";
import type { PlaceholderEntry } from "./backup.ts";
import { redactJsonContent, redactTomlContent, redactProfileEnv, makePlaceholder } from "./redact.ts";

// ─── buildSecretsIndex ────────────────────────────────────────────────

describe("buildSecretsIndex — dedup", () => {
  it("同 fieldName 3 个 distinct value → 3 个 logical key idx 升序", () => {
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/p1/configDir/.mcp.json", fieldPath: "$.token", fieldName: "token", hint: "" },
      { packPath: "profiles/p2/configDir/.mcp.json", fieldPath: "$.token", fieldName: "token", hint: "" },
      { packPath: "profiles/p3/configDir/.mcp.json", fieldPath: "$.token", fieldName: "token", hint: "" },
    ];
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>([
      [placeholders[0]!, "h-aaa"],
      [placeholders[1]!, "h-bbb"],
      [placeholders[2]!, "h-ccc"],
    ]);
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    expect(idx.total_logical_keys).toBe(3);
    expect(idx.entries.map((e) => e.name)).toEqual(["token-1", "token-2", "token-3"]);
    expect(idx.entries.every((e) => e.count === 1)).toBe(true);
  });

  it("同 fieldName + 同 hash 跨 5 profile → 1 logical key + count=5 + profileSet 5 个", () => {
    const placeholders: PlaceholderEntry[] = Array.from({ length: 5 }, (_, i) => ({
      packPath: `profiles/p${i + 1}/configDir/providers/opus.json`,
      fieldPath: "$.env.ANTHROPIC_AUTH_TOKEN",
      fieldName: "ANTHROPIC_AUTH_TOKEN",
      hint: "",
    }));
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>(
      placeholders.map((p) => [p, "same-hash-xxx"]),
    );
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    expect(idx.total_logical_keys).toBe(1);
    expect(idx.entries[0]!.name).toBe("ANTHROPIC_AUTH_TOKEN-1");
    expect(idx.entries[0]!.count).toBe(5);
    expect(idx.entries[0]!.hint).toBe("5 occurrences across 5 profiles");
    expect(idx.entries[0]!.locations).toHaveLength(5);
  });

  it("不变量 total_occurrences === sum(entries[i].count) === placeholders.length（混合 case）", () => {
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/p1/configDir/a.json", fieldPath: "$.t", fieldName: "T", hint: "" },
      { packPath: "profiles/p1/configDir/b.json", fieldPath: "$.t", fieldName: "T", hint: "" },
      { packPath: "profiles/p2/configDir/a.json", fieldPath: "$.t", fieldName: "T", hint: "" },
      { packPath: "profiles/p2/configDir/auth.json", fieldPath: "$.placeholder", fieldName: "AUTH", hint: "" },
    ];
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>([
      [placeholders[0]!, "hh"],     // T 同 hash
      [placeholders[1]!, "hh"],
      [placeholders[2]!, "ii"],     // T 异 hash
      [placeholders[3]!, undefined], // wholeFile, 不参与 dedup
    ]);
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    const sumCount = idx.entries.reduce((s, e) => s + e.count, 0);
    expect(idx.total_occurrences).toBe(4);
    expect(sumCount).toBe(4);
    expect(sumCount).toBe(placeholders.length);
    // T → 2 logical keys (T-1 同 hash 2 处 + T-2 异 hash 1 处)，AUTH → 1 logical key (whole, count=1)
    const byField: Record<string, number> = {};
    for (const e of idx.entries) {
      byField[e.fieldName] = (byField[e.fieldName] ?? 0) + 1;
    }
    expect(byField).toEqual({ T: 2, AUTH: 1 });
    expect(idx.total_logical_keys).toBe(3);
  });

  it("整文件 (valueHash undefined) 每条独立 logical key，count 始终 1，hint 含 whole-file", () => {
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/p1/configDir/auth.json", fieldPath: "$.placeholder", fieldName: "AUTH", hint: "" },
      { packPath: "profiles/p2/configDir/auth.json", fieldPath: "$.placeholder", fieldName: "AUTH", hint: "" },
    ];
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>([
      [placeholders[0]!, undefined],
      [placeholders[1]!, undefined],
    ]);
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    expect(idx.entries).toHaveLength(2);
    expect(idx.entries.every((e) => e.count === 1)).toBe(true);
    expect(idx.entries.every((e) => e.hint.includes("whole-file secret"))).toBe(true);
  });

  it("manifest 不应包含真值 / valueHash 的任何痕迹（不变量 #1）", () => {
    const realValue = "sk-very-secret-real-token-12345";
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/p1/configDir/.mcp.json", fieldPath: "$.token", fieldName: "token", hint: "" },
    ];
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>([
      [placeholders[0]!, "fakehash-not-leaked"],
    ]);
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    const serialized = JSON.stringify(idx);
    expect(serialized).not.toContain(realValue);
    expect(serialized).not.toContain("fakehash-not-leaked");
  });

  it("空 placeholders → entries 空 + total 都 0", () => {
    const idx = buildSecretsIndex([], new Map());
    expect(idx.total_logical_keys).toBe(0);
    expect(idx.total_occurrences).toBe(0);
    expect(idx.entries).toEqual([]);
  });

  it("locations 按 packPath 字典序排序（deterministic）", () => {
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/zz/configDir/a.json", fieldPath: "$.t", fieldName: "T", hint: "" },
      { packPath: "profiles/aa/configDir/a.json", fieldPath: "$.t", fieldName: "T", hint: "" },
      { packPath: "profiles/mm/configDir/a.json", fieldPath: "$.t", fieldName: "T", hint: "" },
    ];
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>([
      [placeholders[0]!, "h"],
      [placeholders[1]!, "h"],
      [placeholders[2]!, "h"],
    ]);
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    expect(idx.entries[0]!.locations.map((l) => l.packPath)).toEqual([
      "profiles/aa/configDir/a.json",
      "profiles/mm/configDir/a.json",
      "profiles/zz/configDir/a.json",
    ]);
  });

  // CHANGELOG_20: cross-fieldName dedup —— 同一 token 用多个 fieldName 命名也合并
  it("跨 fieldName 同 hash → 合并 1 个 logical key + fieldNames 列全部 fieldName", () => {
    // 模拟同一个 GitLab PAT 在 3 个 plugin 配置里被命名为不同的字段名
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/p1/configDir/.mcp.json", fieldPath: "$.a.GITLAB_PAT", fieldName: "GITLAB_PAT", hint: "" },
      { packPath: "profiles/p1/configDir/.mcp.json", fieldPath: "$.b.TOKEN", fieldName: "TOKEN", hint: "" },
      { packPath: "profiles/p2/configDir/.mcp.json", fieldPath: "$.c.TOKEN", fieldName: "TOKEN", hint: "" },
      { packPath: "profiles/p2/configDir/.mcp.json", fieldPath: "$.d.lark_token", fieldName: "lark_token", hint: "" },
    ];
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>(
      placeholders.map((p) => [p, "same-token-hash"]),
    );
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    expect(idx.total_logical_keys).toBe(1);
    expect(idx.entries[0]!.count).toBe(4);
    // primary fieldName: TOKEN 出现 2 次（最多）→ 当 primary
    expect(idx.entries[0]!.fieldName).toBe("TOKEN");
    expect(idx.entries[0]!.name).toBe("TOKEN-1");
    // fieldNames: 3 个 distinct，按字典序排
    expect(idx.entries[0]!.fieldNames).toEqual(["GITLAB_PAT", "TOKEN", "lark_token"]);
    // hint 含「3 field names」提示
    expect(idx.entries[0]!.hint).toContain("3 field names");
    expect(idx.entries[0]!.hint).toContain("GITLAB_PAT / TOKEN / lark_token");
  });

  it("primary fieldName 并列时按字典序最小（deterministic）", () => {
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/p1/configDir/a.json", fieldPath: "$.zzz", fieldName: "zzz", hint: "" },
      { packPath: "profiles/p2/configDir/a.json", fieldPath: "$.aaa", fieldName: "aaa", hint: "" },
    ];
    // zzz / aaa 各 1 次，都同 hash → 合并 1 个 group
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>([
      [placeholders[0]!, "h"],
      [placeholders[1]!, "h"],
    ]);
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    expect(idx.total_logical_keys).toBe(1);
    // 并列时字典序最小：aaa
    expect(idx.entries[0]!.fieldName).toBe("aaa");
  });

  it("单 fieldName group：fieldNames 仅含 1 个 + hint 不含「N field names」段（向后兼容老体验）", () => {
    const placeholders: PlaceholderEntry[] = [
      { packPath: "profiles/p1/configDir/a.json", fieldPath: "$.t", fieldName: "ANTHROPIC_AUTH_TOKEN", hint: "" },
      { packPath: "profiles/p2/configDir/a.json", fieldPath: "$.t", fieldName: "ANTHROPIC_AUTH_TOKEN", hint: "" },
    ];
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>([
      [placeholders[0]!, "h"],
      [placeholders[1]!, "h"],
    ]);
    const idx = buildSecretsIndex(placeholders, hashByEntry);
    expect(idx.entries[0]!.fieldNames).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
    expect(idx.entries[0]!.hint).not.toContain("field names");
    expect(idx.entries[0]!.hint).toBe("2 occurrences across 2 profiles");
  });
});

// ─── parseFieldPath / setByFieldPath ─────────────────────────────────

describe("parseFieldPath — JSON / TOML 双形式", () => {
  it("JSON 嵌套对象：$.a.b.c → 3 段 key", () => {
    const r = parseFieldPath("$.a.b.c");
    expect(r.kind).toBe("json");
    expect(r.segments).toEqual([
      { type: "key", key: "a" },
      { type: "key", key: "b" },
      { type: "key", key: "c" },
    ]);
  });

  it("JSON 含数组索引：$.items[0].token → key + index + key", () => {
    const r = parseFieldPath("$.items[0].token");
    expect(r.segments).toEqual([
      { type: "key", key: "items" },
      { type: "index", index: 0 },
      { type: "key", key: "token" },
    ]);
  });

  it("JSON 二维数组：$.a[0][1] → key + 2 index", () => {
    const r = parseFieldPath("$.a[0][1]");
    expect(r.segments).toEqual([
      { type: "key", key: "a" },
      { type: "index", index: 0 },
      { type: "index", index: 1 },
    ]);
  });

  it("TOML dot-path：a.b.c → key key key（无 $. 前缀）", () => {
    const r = parseFieldPath("server.intern.api_key");
    expect(r.kind).toBe("toml");
    expect(r.segments.map((s) => (s.type === "key" ? s.key : s.index))).toEqual([
      "server", "intern", "api_key",
    ]);
  });

  it("$.env.OPENAI_API_KEY（含下划线 / 大写 / env 段）", () => {
    const r = parseFieldPath("$.env.OPENAI_API_KEY");
    expect(r.segments).toEqual([
      { type: "key", key: "env" },
      { type: "key", key: "OPENAI_API_KEY" },
    ]);
  });

  it("整文件占位 $.placeholder → 单段 key", () => {
    const r = parseFieldPath("$.placeholder");
    expect(r.segments).toEqual([{ type: "key", key: "placeholder" }]);
  });

  it("根 $ → segments 空", () => {
    const r = parseFieldPath("$");
    expect(r.segments).toEqual([]);
  });

  it("未闭合 [ → 抛错", () => {
    expect(() => parseFieldPath("$.a[0")).toThrow(/unclosed/);
  });
});

describe("setByFieldPath — 寻址写入", () => {
  it("JSON 嵌套对象 string leaf 替换", () => {
    const obj = { a: { b: { c: "old" } } } as unknown;
    const segs = parseFieldPath("$.a.b.c").segments;
    expect(setByFieldPath(obj, segs, "new")).toBe(true);
    expect((obj as { a: { b: { c: string } } }).a.b.c).toBe("new");
  });

  it("JSON 数组里 string leaf 替换", () => {
    const obj = { items: [{ token: "old" }] } as unknown;
    const segs = parseFieldPath("$.items[0].token").segments;
    expect(setByFieldPath(obj, segs, "new")).toBe(true);
    expect((obj as { items: { token: string }[] }).items[0]!.token).toBe("new");
  });

  it("中间节点缺失 → false（不写）", () => {
    const obj = { a: {} } as unknown;
    const segs = parseFieldPath("$.a.b.c").segments;
    expect(setByFieldPath(obj, segs, "new")).toBe(false);
  });

  it("leaf 不是 string（数字 / 布尔）→ false", () => {
    const obj = { count: 42 } as unknown;
    expect(setByFieldPath(obj, parseFieldPath("$.count").segments, "new")).toBe(false);
  });

  it("数组越界 → false", () => {
    const obj = { items: [] } as unknown;
    expect(setByFieldPath(obj, parseFieldPath("$.items[0]").segments, "x")).toBe(false);
  });

  it("空 segments（root 替换）→ false（明文禁止）", () => {
    expect(setByFieldPath({ a: 1 }, [], "x")).toBe(false);
  });

  it("set 的 key 在对象上不存在（hasOwnProperty=false）→ false", () => {
    const obj = { a: "x" } as unknown;
    expect(setByFieldPath(obj, parseFieldPath("$.b").segments, "new")).toBe(false);
  });
});

// ─── redact → 寻址 → 改回 → stringify 对称循环 ─────────────────────

describe("对称循环：redact → fieldPath → setByFieldPath（JSON）", () => {
  it("嵌套对象：redact 后 fieldPath 能反向 set 真值", () => {
    const original = { mcpServers: { intern: { env: { INTERN_TOKEN: "ghp_real" } } } };
    const r = redactJsonContent(JSON.stringify(original));
    expect(r.placeholders).toHaveLength(1);
    const fp = r.placeholders[0]!.fieldPath;
    expect(fp).toBe("$.mcpServers.intern.env.INTERN_TOKEN");

    // 反向：parse redacted → set fieldPath → 应得真值占位
    const parsed = JSON.parse(r.content);
    const segs = parseFieldPath(fp).segments;
    expect(setByFieldPath(parsed, segs, "ghp_back")).toBe(true);
    expect(parsed.mcpServers.intern.env.INTERN_TOKEN).toBe("ghp_back");
  });

  it("数组场景：$.items[i].token 双向", () => {
    const original = { items: [{ token: "a" }, { token: "b" }] };
    const r = redactJsonContent(JSON.stringify(original));
    const parsed = JSON.parse(r.content);
    for (const ph of r.placeholders) {
      expect(setByFieldPath(parsed, parseFieldPath(ph.fieldPath).segments, `filled-${ph.fieldPath}`)).toBe(true);
    }
    expect(parsed.items[0]!.token).toBe("filled-$.items[0].token");
    expect(parsed.items[1]!.token).toBe("filled-$.items[1].token");
  });
});

describe("对称循环：redact → fieldPath → setByFieldPath（TOML）", () => {
  it("section 内 dot-path 双向", async () => {
    const r = redactTomlContent(`[server.intern]\napi_key = "secret"\n`);
    expect(r.placeholders).toHaveLength(1);
    const fp = r.placeholders[0]!.fieldPath;
    expect(fp).toBe("server.intern.api_key");
    expect(r.content).toContain(makePlaceholder("api_key"));

    // smol-toml 反向 parse → set → stringify
    const { parse: parseToml, stringify: stringifyToml } = await import("smol-toml");
    const parsed = parseToml(r.content) as Record<string, unknown>;
    expect(setByFieldPath(parsed, parseFieldPath(fp).segments, "the-real-key")).toBe(true);
    const out = stringifyToml(parsed);
    expect(out).toContain('"the-real-key"');
    expect(out).not.toContain(makePlaceholder("api_key"));
  });
});

describe("redactProfileEnv → fieldPath 形式（env.K）", () => {
  it("env.K 走 TOML dot-path 解析（兼容 backup.ts:300 重写前的形式）", () => {
    const r = redactProfileEnv({ ANTHROPIC_API_KEY: "sk-real" });
    expect(r.placeholders[0]!.fieldPath).toBe("env.ANTHROPIC_API_KEY");
    const parsed = parseFieldPath(r.placeholders[0]!.fieldPath);
    expect(parsed.kind).toBe("toml");
    expect(parsed.segments).toEqual([
      { type: "key", key: "env" },
      { type: "key", key: "ANTHROPIC_API_KEY" },
    ]);
  });
});
