#!/usr/bin/env bun
/**
 * Schema 同步 / 自洽校验工具（PR-J 完整化）。
 *
 * **三个模式**：
 *
 *   1. **默认（无参）**：列出所有已注册 schema 的元信息（scope / source / fetched / 字段数）
 *   2. **`--check-self`**：用 ajv compile 校验所有本地 schema 自洽（CI 友好，schema 写错立刻 fail）
 *   3. **`--fetch <scope>`**：fetch 单个上游 source URL，简单 diff 上游字段名 vs 本地 schema 字段名
 *      （只列字段差异，不做深 schema diff —— 深 diff 需要人工对照 enum / default / range 改动）
 *
 * **CI 推荐用法**：
 *   `bun src/schemas/sync.ts --check-self`  // schema 自洽检查
 *   每周 cron：`bun src/schemas/sync.ts --fetch claude-settings`  // 上游 diff 报告
 *
 * 用法：
 *   bun src/schemas/sync.ts                          # 元信息总览
 *   bun src/schemas/sync.ts --check-self             # ajv 自洽校验
 *   bun src/schemas/sync.ts --fetch claude-settings  # diff 上游
 */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { listRegisteredSchemas, getSchemaForScope } from "./registry.ts";
import { toolSchemaToJsonSchema } from "./to-json-schema.ts";
import type { ScopeKind } from "./types.ts";

function fieldCount(schema: ReturnType<typeof toolSchemaToJsonSchema>): number {
  const props = (schema as Record<string, unknown>).properties as Record<string, unknown> | undefined;
  return props ? Object.keys(props).length : 0;
}

async function listAll(): Promise<void> {
  const schemas = listRegisteredSchemas();
  console.log(`已注册 ${schemas.length} 份 schema：\n`);
  for (const s of schemas) {
    const std = toolSchemaToJsonSchema(s);
    console.log(`  ${s.$id}`);
    console.log(`    scope:   ${s.scopeKind}`);
    console.log(`    source:  ${s.$source}`);
    console.log(`    fetched: ${s.fetchedAt}`);
    console.log(`    fields:  ${fieldCount(std)}\n`);
  }
}

async function checkSelf(): Promise<number> {
  // ajv@8 默认不识别 draft 2020-12 $schema URI；本检查只关心 schema 自洽，
  // 删 $schema 标识符再 compile 即可（codemirror-json-schema 仍能消费 $schema）
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemas = listRegisteredSchemas();
  let failed = 0;
  for (const s of schemas) {
    try {
      const std = toolSchemaToJsonSchema(s);
      const stdNoSchema = { ...std };
      delete (stdNoSchema as Record<string, unknown>).$schema;
      ajv.compile(stdNoSchema);
      console.log(`  ✅ ${s.$id} (${s.scopeKind})`);
    } catch (e) {
      console.log(`  ❌ ${s.$id} (${s.scopeKind}): ${(e as Error).message}`);
      failed++;
    }
  }
  console.log(`\n${schemas.length - failed} / ${schemas.length} pass`);
  return failed;
}

async function fetchAndDiff(scope: ScopeKind): Promise<number> {
  const tool = getSchemaForScope(scope);
  if (!tool) {
    console.error(`未注册 scope: ${scope}`);
    return 1;
  }
  console.log(`Fetching ${tool.$source} ...`);
  let upstream: Record<string, unknown>;
  try {
    const res = await fetch(tool.$source);
    if (!res.ok) {
      console.error(`HTTP ${res.status} ${res.statusText}`);
      return 1;
    }
    const text = await res.text();
    try {
      upstream = JSON.parse(text);
    } catch {
      console.log(`上游不是 JSON Schema 格式（可能是 HTML docs）。仅打印前 500 字节供人工对照：\n`);
      console.log(text.slice(0, 500));
      return 0;
    }
  } catch (e) {
    console.error(`fetch 失败：${(e as Error).message}`);
    return 1;
  }

  const upstreamProps = (upstream.properties as Record<string, unknown> | undefined) ?? {};
  const localStd = toolSchemaToJsonSchema(tool);
  const localProps = (localStd.properties as Record<string, unknown> | undefined) ?? {};
  const upstreamKeys = new Set(Object.keys(upstreamProps));
  const localKeys = new Set(Object.keys(localProps));

  const onlyUpstream = [...upstreamKeys].filter((k) => !localKeys.has(k));
  const onlyLocal = [...localKeys].filter((k) => !upstreamKeys.has(k));
  const both = [...upstreamKeys].filter((k) => localKeys.has(k));

  console.log(`\n上游字段数：${upstreamKeys.size}`);
  console.log(`本地字段数：${localKeys.size}`);
  console.log(`公共：${both.length}\n`);

  if (onlyUpstream.length > 0) {
    console.log(`⚠ 上游有但本地缺（建议补到本地 schema）：${onlyUpstream.length} 个`);
    for (const k of onlyUpstream) console.log(`  + ${k}`);
  }
  if (onlyLocal.length > 0) {
    console.log(`\n⚠ 本地有但上游无（可能上游已删 / 本地命名错）：${onlyLocal.length} 个`);
    for (const k of onlyLocal) console.log(`  - ${k}`);
  }
  if (onlyUpstream.length === 0 && onlyLocal.length === 0) {
    console.log("✅ 顶层字段完全一致（深 schema diff 仍需人工对照 enum / default / range）");
  }
  return 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await listAll();
    return;
  }
  if (args[0] === "--check-self") {
    const failed = await checkSelf();
    process.exit(failed > 0 ? 1 : 0);
  }
  if (args[0] === "--list-scopes") {
    // REVIEW_4 M10：CI 用，避免 workflow YAML 硬编码 scope 列表
    for (const s of listRegisteredSchemas()) console.log(s.scopeKind);
    return;
  }
  if (args[0] === "--fetch") {
    const scope = args[1] as ScopeKind | undefined;
    if (!scope) {
      console.error("用法：bun src/schemas/sync.ts --fetch <scope>");
      console.error("可用 scope:", listRegisteredSchemas().map((s) => s.scopeKind).join(", "));
      process.exit(1);
    }
    const code = await fetchAndDiff(scope);
    process.exit(code);
  }
  console.error("未知参数。用法：");
  console.error("  bun src/schemas/sync.ts                       # 元信息总览");
  console.error("  bun src/schemas/sync.ts --check-self          # ajv 自洽校验");
  console.error("  bun src/schemas/sync.ts --list-scopes         # 列所有已注册 scope（CI 动态枚举用）");
  console.error("  bun src/schemas/sync.ts --fetch <scope>       # diff 上游");
  process.exit(1);
}

main();
