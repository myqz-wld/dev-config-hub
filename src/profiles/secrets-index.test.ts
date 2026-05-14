import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSecretsIndex,
  parseFieldPath,
  setByFieldPath,
  applyFilledSecrets,
  type SecretsIndex,
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

// ─── applyFilledSecrets — 全 fan-out 写盘 ────────────────────────────

describe("applyFilledSecrets — fan-out 多文件写盘", () => {
  // **REVIEW_9 A-codex L1**: tmpDir typed `string | undefined` + afterEach guard。旧实现
  // beforeEach 失败时 tmpDir 仍是 undefined,afterEach 直接 `await rm(undefined, ...)` 抛
  // ERR_INVALID_ARG_TYPE 让全部 testcase 雪崩(7 个 EPERM 实测)。
  let tmpDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dch-fill-test-"));
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("跨 2 文件 fan-out + filledLocations 复合 key 准确", async () => {
    const fileA = join(tmpDir!, "a.json");
    const fileB = join(tmpDir!, "b.json");
    await Bun.write(fileA, JSON.stringify({ env: { TOKEN: makePlaceholder("TOKEN") } }, null, 2) + "\n");
    await Bun.write(fileB, JSON.stringify({ env: { TOKEN: makePlaceholder("TOKEN") } }, null, 2) + "\n");

    const idx: SecretsIndex = {
      schema_version: 1,
      total_logical_keys: 1,
      total_occurrences: 2,
      entries: [{
        name: "TOKEN-1",
        fieldName: "TOKEN",
        count: 2,
        hint: "2 occurrences across 2 profiles",
        locations: [
          { packPath: "profiles/a/configDir/a.json", fieldPath: "$.env.TOKEN" },
          { packPath: "profiles/b/configDir/b.json", fieldPath: "$.env.TOKEN" },
        ],
      }],
    };
    const resolveHostPath = (pp: string): string | undefined => {
      if (pp.endsWith("/a.json")) return fileA;
      if (pp.endsWith("/b.json")) return fileB;
      return undefined;
    };
    const r = await applyFilledSecrets(idx, { "TOKEN-1": "sk-filled" }, resolveHostPath);
    expect(r.written).toBe(2);
    expect(r.skipped).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.filledLocations).toEqual(new Set([
      "profiles/a/configDir/a.json|$.env.TOKEN",
      "profiles/b/configDir/b.json|$.env.TOKEN",
    ]));

    const aRead = JSON.parse(await Bun.file(fileA).text());
    const bRead = JSON.parse(await Bun.file(fileB).text());
    expect(aRead.env.TOKEN).toBe("sk-filled");
    expect(bRead.env.TOKEN).toBe("sk-filled");
  });

  it("secretsMap 缺 key → 计入 skipped（user-skip 语义）", async () => {
    const fileA = join(tmpDir!, "a.json");
    await Bun.write(fileA, JSON.stringify({ token: makePlaceholder("token") }) + "\n");
    const idx: SecretsIndex = {
      schema_version: 1, total_logical_keys: 1, total_occurrences: 1,
      entries: [{
        name: "token-1", fieldName: "token", count: 1, hint: "",
        locations: [{ packPath: "profiles/a/configDir/a.json", fieldPath: "$.token" }],
      }],
    };
    const r = await applyFilledSecrets(idx, {}, () => fileA);
    expect(r.written).toBe(0);
    expect(r.skipped).toEqual(["token-1"]);

    // 文件未动
    const text = await Bun.file(fileA).text();
    expect(text).toContain(makePlaceholder("token"));
  });

  it("secretsMap 多 key（不在 idx）→ 计入 unknown，不 fail", async () => {
    const fileA = join(tmpDir!, "a.json");
    await Bun.write(fileA, JSON.stringify({ token: makePlaceholder("token") }) + "\n");
    const idx: SecretsIndex = {
      schema_version: 1, total_logical_keys: 1, total_occurrences: 1,
      entries: [{
        name: "token-1", fieldName: "token", count: 1, hint: "",
        locations: [{ packPath: "profiles/a/configDir/a.json", fieldPath: "$.token" }],
      }],
    };
    const r = await applyFilledSecrets(
      idx,
      { "token-1": "filled", "BOGUS-99": "unused" },
      () => fileA,
    );
    expect(r.written).toBe(1);
    expect(r.unknown).toEqual(["BOGUS-99"]);
    expect(r.errors).toEqual([]);
  });

  it("hostPath unresolved（_meta.json 段）→ 跳过该 location，不计入 errors", async () => {
    const idx: SecretsIndex = {
      schema_version: 1, total_logical_keys: 1, total_occurrences: 1,
      entries: [{
        name: "ENV-1", fieldName: "ENV", count: 1, hint: "",
        locations: [{ packPath: "profiles/a/_meta.json", fieldPath: "$.env.K" }],
      }],
    };
    const r = await applyFilledSecrets(idx, { "ENV-1": "x" }, () => undefined);
    expect(r.written).toBe(0);
    expect(r.errors).toEqual([]);
    expect(r.filledLocations.size).toBe(0);
  });

  it("文件后缀非 .json/.toml → errors[] + skip", async () => {
    const fileBin = join(tmpDir!, "x.bin");
    await Bun.write(fileBin, "binary blob");
    const idx: SecretsIndex = {
      schema_version: 1, total_logical_keys: 1, total_occurrences: 1,
      entries: [{
        name: "K-1", fieldName: "K", count: 1, hint: "",
        locations: [{ packPath: "profiles/a/configDir/x.bin", fieldPath: "$.k" }],
      }],
    };
    const r = await applyFilledSecrets(idx, { "K-1": "v" }, () => fileBin);
    expect(r.written).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("文件后缀");
  });

  it("parse 失败 → errors[] + 不动文件（部分写防护）", async () => {
    const fileBad = join(tmpDir!, "bad.json");
    await Bun.write(fileBad, "{ invalid json");
    const idx: SecretsIndex = {
      schema_version: 1, total_logical_keys: 1, total_occurrences: 1,
      entries: [{
        name: "K-1", fieldName: "K", count: 1, hint: "",
        locations: [{ packPath: "profiles/a/configDir/bad.json", fieldPath: "$.k" }],
      }],
    };
    const r = await applyFilledSecrets(idx, { "K-1": "v" }, () => fileBad);
    expect(r.written).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("parse 失败");
    // 文件未被改动
    const text = await Bun.file(fileBad).text();
    expect(text).toBe("{ invalid json");
  });

  it("寻址失败 → errors[] 单条，不阻断同文件其他 location", async () => {
    const fileA = join(tmpDir!, "a.json");
    await Bun.write(fileA, JSON.stringify({ ok: makePlaceholder("ok") }, null, 2) + "\n");
    const idx: SecretsIndex = {
      schema_version: 1, total_logical_keys: 2, total_occurrences: 2,
      entries: [
        {
          name: "ok-1", fieldName: "ok", count: 1, hint: "",
          locations: [{ packPath: "profiles/a/configDir/a.json", fieldPath: "$.ok" }],
        },
        {
          name: "miss-1", fieldName: "miss", count: 1, hint: "",
          locations: [{ packPath: "profiles/a/configDir/a.json", fieldPath: "$.absent.path" }],
        },
      ],
    };
    const r = await applyFilledSecrets(
      idx,
      { "ok-1": "filled-ok", "miss-1": "x" },
      () => fileA,
    );
    expect(r.written).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("寻址失败");
    // 写盘后只 ok 被替换
    const obj = JSON.parse(await Bun.file(fileA).text());
    expect(obj.ok).toBe("filled-ok");
  });
});

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
