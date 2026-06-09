import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyFilledSecrets,
  type SecretsIndex,
} from "./secrets-index.ts";
import { makePlaceholder } from "./redact.ts";

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
