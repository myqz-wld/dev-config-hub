#!/usr/bin/env bun
/**
 * `dch profile backup` / `restore` / `backups` / `backup-rm` / `backup-pin` 子命令实现。
 *
 * 抽离 cli-profile.ts 的原因：
 * 1. cli-profile.ts 已 588 行超 500 护栏（CLAUDE.md 现存超标已知）
 * 2. backup 子命令簇 5 个 cmd + 2 个 print helper，独立模块语义干净
 *
 * 共享 helper 走 cli-shared.ts；createBackup / parseBackup / applyBackup 走 backup.ts；
 * listBackups / deleteBackup / pinBackup 走 backup-manage.ts。
 */

import { c } from "./cli-colors.ts";
import {
  isJsonMode, jsonOut, ok, info, err,
  parseFlags, readStdinLine, readStdinSecret, formatBytes,
} from "./cli-shared.ts";
import {
  createBackup, parseBackup, applyBackup, applyBackupWithSecrets, cleanupParsed,
  type Manifest, type ApplyBackupResult, type ApplyBackupWithSecretsResult,
} from "./profiles/backup.ts";
import type { SecretsIndex } from "./profiles/secrets-index.ts";
import {
  listBackups, deleteBackup, pinBackup,
  DEFAULT_PATH, BACKUP_DIR,
  type BackupSummary,
} from "./profiles/backup-manage.ts";

// REVIEW_8 M11 / B6：每个 cmd 显式 allowed flag 集合（防 typo 被吞）。
const BACKUP_ALLOWED = new Set(["out", "profiles", "no-shared", "no-placeholder", "yes", "keep"]);
const RESTORE_ALLOWED = new Set(["prefix", "rename", "dry-run", "yes", "allow-original-path", "fill-secrets", "secrets-json"]);
const BACKUP_RM_ALLOWED = new Set(["yes"]);
const BACKUP_PIN_ALLOWED = new Set(["unpin"]);

// ─── backup ──────────────────────────────────────────────────────────────

export async function cmdBackup(args: string[]): Promise<void> {
  const { flags } = parseFlags(args, { allowedFlags: BACKUP_ALLOWED });
  const noPlaceholder = flags["no-placeholder"] === true;
  const includeShared = flags["no-shared"] !== true;
  const yes = flags.yes === true;
  const keep = flags.keep === true;
  const profileIds = typeof flags.profiles === "string"
    ? flags.profiles.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const outFile = typeof flags.out === "string" ? flags.out : undefined;

  if (noPlaceholder && !yes) {
    if (isJsonMode()) {
      err("--no-placeholder 在 --json 模式下必须配 --yes（避免脚本误用泄露明文凭据）");
    }
    process.stdout.write(`${c.yellow}⚠ --no-placeholder：备份将含明文 token / API key${c.reset}\n`);
    process.stdout.write(`${c.yellow}  请确认你只在加密渠道（gpg / age / 本地）使用此包。继续? [y/N] ${c.reset}`);
    const line = await readStdinLine();
    if (line.toLowerCase() !== "y" && line.toLowerCase() !== "yes") {
      info("已取消");
      return;
    }
  }

  const result = await createBackup({ outFile, profileIds, includeShared, noPlaceholder, keep });

  if (isJsonMode()) return jsonOut({ ok: true, ...result });
  const slot = !outFile && !keep
    ? `${c.gray}（默认位，已覆盖）${c.reset}`
    : !outFile && keep
    ? `${c.gray}（历史副本，已保留）${c.reset}`
    : "";
  ok(`已写入 ${result.outFile} (${formatBytes(result.bytes)}) ${slot}`);
  info(`包含 ${result.manifest.profiles.length} 个 profile: ${result.manifest.profiles.map((p) => p.id).join(", ")}`);
  if (result.manifest.shared.dch_scripts.length || result.manifest.shared.agents_paths.length) {
    info(`共享资源: ${result.manifest.shared.dch_scripts.length} 个 hook 脚本, ${result.manifest.shared.agents_paths.length} 个 agent 文件`);
  }
  if (result.manifest.placeholders.length > 0) {
    process.stdout.write(`${c.yellow}⚠ 已脱敏 ${result.manifest.placeholders.length} 处凭据${c.reset}\n`);
  }
  if (noPlaceholder) {
    process.stdout.write(`${c.red}⚠ --no-placeholder 模式：包内含明文凭据，请只通过加密渠道分享${c.reset}\n`);
  }
  info(`还原方式: dch profile restore ${result.outFile}`);
  if (!outFile && !keep) {
    info(`列出所有备份: dch profile backups`);
  }
}

// ─── restore ─────────────────────────────────────────────────────────────

export async function cmdRestore(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args, { allowedFlags: RESTORE_ALLOWED });
  const [packFile] = positional;
  if (!packFile) {
    err("用法: dch profile restore <pack> [--prefix <p>] [--rename OLD=NEW,...] [--dry-run] [--yes] [--fill-secrets | --secrets-json <file>]");
  }

  const dryRun = flags["dry-run"] === true;
  const fillSecrets = flags["fill-secrets"] === true;
  const secretsJsonFile = typeof flags["secrets-json"] === "string" ? flags["secrets-json"] : undefined;
  if (fillSecrets && secretsJsonFile) {
    err("--fill-secrets 与 --secrets-json 互斥（只能用一个）");
  }
  if ((fillSecrets || secretsJsonFile) && dryRun) {
    err("--fill-secrets / --secrets-json 不能与 --dry-run 同用（dry-run 不写盘）");
  }
  if (fillSecrets && isJsonMode()) {
    err("--fill-secrets 是交互式输入，不能与 --json 同用；自动化场景请用 --secrets-json <file>");
  }
  const prefix = typeof flags.prefix === "string" ? flags.prefix : undefined;
  // REVIEW_8 H5 / D3：opt-in 才允许尊重 manifest 携带的 configDir_original，否则一律落
  // ~/.dch-restored/<finalId>/。即使 opt-in 也走 validateRestorePath 二道防线（拒非 HOME / .. / 黑名单）。
  const allowOriginalPath = flags["allow-original-path"] === true;
  const renameMap: Record<string, string> = {};
  if (typeof flags.rename === "string") {
    for (const pair of flags.rename.split(",")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) err(`--rename 格式 OLD=NEW (收到 ${trimmed})`);
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!k || !v) err(`--rename 格式 OLD=NEW (收到 ${trimmed})`);
      renameMap[k] = v;
    }
  }

  const parsed = await parseBackup(packFile);
  try {
    const dryPlan = await applyBackup({ parsed, prefix, renameMap, allowOriginalPath, dryRun: true });

    if (dryRun) {
      if (isJsonMode()) return jsonOut({ ok: true, dryRun: true, manifest: parsed.manifest, plan: dryPlan });
      printRestorePreview(parsed.manifest, dryPlan);
      return;
    }

    const idx = parsed.manifest.secrets_index;
    const hasSecretsIndex = !!idx && idx.entries.length > 0;

    // 分支 A：--secrets-json 自动化
    if (secretsJsonFile) {
      const secretsMap = await loadSecretsJson(secretsJsonFile);
      if (!hasSecretsIndex) {
        info("备份内无 secrets_index（旧 pack / no-placeholder），--secrets-json 被忽略走普通 restore");
      }
      const result = await applyBackupWithSecrets({ parsed, prefix, renameMap, allowOriginalPath, secretsMap });
      await printRestoreResult(parsed.manifest, result);
      return;
    }

    // 分支 B：--fill-secrets 交互
    if (fillSecrets) {
      if (!hasSecretsIndex) {
        info("备份内无 secrets_index（旧 pack / no-placeholder），--fill-secrets 无意义，走普通 restore");
        const result = await applyBackup({ parsed, prefix, renameMap, allowOriginalPath });
        await printRestoreResult(parsed.manifest, result);
        return;
      }
      const secretsMap = await promptSecretsInteractive(idx);
      if (secretsMap === null) {
        info("已中止（Ctrl+C），未写盘");
        return;
      }
      const result = await applyBackupWithSecrets({ parsed, prefix, renameMap, allowOriginalPath, secretsMap });
      await printRestoreResult(parsed.manifest, result);
      return;
    }

    // 分支 C：都不传 → 现状走 applyBackup + 尾部加提示
    const result = await applyBackup({ parsed, prefix, renameMap, allowOriginalPath });
    await printRestoreResult(parsed.manifest, result);
    if (hasSecretsIndex && !isJsonMode()) {
      info(`💡 备份内含 ${idx.total_logical_keys} 个唯一凭据；下次可用 --fill-secrets 交互填入或 --secrets-json <file> 自动化`);
    }
  } finally {
    await cleanupParsed(parsed);
  }
}

/**
 * 读 --secrets-json 文件并校验 schema：必须 plain object，所有 value 是 string。
 * 失败 → err() 立即 exit。**绝不**把文件内容打回 stdout（含真值）。
 */
async function loadSecretsJson(file: string): Promise<Record<string, string>> {
  let raw: unknown;
  try {
    raw = await Bun.file(file).json();
  } catch (e) {
    err(`--secrets-json 读取/解析失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    err(`--secrets-json 必须是 JSON object: { "logical_key": "value" }`);
  }
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string") {
      err(`--secrets-json 值类型错: key="${k}" 不是 string`);
    }
    map[k] = v;
  }
  return map;
}

/**
 * --fill-secrets 交互模式：按 idx.entries 顺序逐个 prompt 隐藏输入。
 *
 * - 每项显示 `[i/N] <logical_key> (count, hint)` + 前 3 个 packPath 预览
 * - ENTER 直接跳过（不计入 map → applyFilledSecrets 把它记到 secretsSkipped）
 * - Ctrl+C 中止 → 返回 null，caller 不调 applyBackupWithSecrets，走 finally cleanup
 * - **secret value 永不打到 stdout**（plan 风险节第 7 条）：日志只用 logical key 名 / count，不传 value
 */
async function promptSecretsInteractive(idx: SecretsIndex): Promise<Record<string, string> | null> {
  process.stdout.write(
    `${c.bold}填入 ${idx.total_logical_keys} 个唯一凭据${c.reset} ` +
    `${c.gray}(${idx.total_occurrences} 处占位符 · ENTER 跳过 · Ctrl+C 中止)${c.reset}\n\n`,
  );
  const map: Record<string, string> = {};
  let i = 0;
  for (const e of idx.entries) {
    i++;
    process.stdout.write(
      `${c.gray}[${i}/${idx.total_logical_keys}]${c.reset} ` +
      `${c.bold}${e.name}${c.reset} ${c.gray}(count=${e.count}, ${e.hint})${c.reset}\n`,
    );
    const previewLocs = e.locations.slice(0, 3);
    for (const loc of previewLocs) {
      process.stdout.write(`  ${c.gray}↳ ${loc.packPath}${c.reset}\n`);
    }
    if (e.locations.length > previewLocs.length) {
      process.stdout.write(`  ${c.gray}↳ +${e.locations.length - previewLocs.length} more${c.reset}\n`);
    }
    process.stdout.write(`${c.cyan}Value (隐藏，ENTER 跳过): ${c.reset}`);
    const v = await readStdinSecret();
    if (v === null) return null;
    if (v) map[e.name] = v;
  }
  return map;
}

/**
 * 还原结果统一输出（兼容 ApplyBackupResult / ApplyBackupWithSecretsResult）。
 * 后者多打一段「凭据填入：已填 X 处 · 跳过 Y · 未知 Z」。
 */
async function printRestoreResult(
  manifest: Manifest,
  result: ApplyBackupResult | ApplyBackupWithSecretsResult,
): Promise<void> {
  if (isJsonMode()) {
    await jsonOut({ ok: result.errors.length === 0, manifest, ...result });
    // REVIEW_8 H6 / B3：errors.length>0 让 exit code 反映出来，Tauri bridge 才能 throw。
    if (result.errors.length > 0) process.exit(1);
    return;
  }

  if (result.errors.length > 0) {
    for (const e of result.errors) process.stdout.write(`${c.red}✗ ${e}${c.reset}\n`);
  }
  ok(`已还原 ${result.appliedProfiles.length} 个 profile`);
  for (const ap of result.appliedProfiles) {
    const tag = ap.conflict === "none" ? "" : ` ${c.gray}[${ap.conflict}]${c.reset}`;
    info(`  ${ap.originalId} → ${c.bold}${ap.finalId}${c.reset} (${ap.configDir})${tag}`);
  }
  if (result.sharedActions.length > 0) {
    info(`共享资源 ${result.sharedActions.length} 项:`);
    for (const sa of result.sharedActions) {
      info(`  ${sa.category} ${sa.relPath} → ${sa.action}`);
    }
  }

  if ("secretsApplied" in result) {
    const r = result;
    process.stdout.write(
      `${c.bold}凭据填入${c.reset}: ` +
      `已填 ${c.green}${r.secretsApplied}${c.reset} 处 · ` +
      `跳过 ${c.yellow}${r.secretsSkipped.length}${c.reset} 个 logical key · ` +
      `未知 ${r.secretsUnknown.length > 0 ? c.red : c.gray}${r.secretsUnknown.length}${c.reset}\n`,
    );
    if (r.secretsUnknown.length > 0) {
      for (const k of r.secretsUnknown) info(`  unknown logical key: ${k}`);
    }
    if (r.secretsErrors.length > 0) {
      info(`secrets-fill 错误 ${r.secretsErrors.length} 条:`);
      for (const e of r.secretsErrors.slice(0, 5)) info(`  ${e}`);
      if (r.secretsErrors.length > 5) info(`  ... +${r.secretsErrors.length - 5} more`);
    }
  }

  if (result.placeholders.length > 0) {
    process.stdout.write(`${c.yellow}剩余占位符 ${result.placeholders.length} 处${c.reset}`);
    if ("secretsApplied" in result) {
      process.stdout.write(`${c.gray}（fan-out 后未替换的，多为 _meta.json env 段，需手改 ~/.dch/profiles.json）${c.reset}`);
    }
    process.stdout.write(":\n");
    const shown = result.placeholders.slice(0, 20);
    for (const ph of shown) {
      process.stdout.write(`  ${ph.hostPath ?? ph.packPath} :: ${ph.fieldName} — ${ph.hint}\n`);
    }
    if (result.placeholders.length > 20) {
      process.stdout.write(`  ${c.gray}... +${result.placeholders.length - 20} more${c.reset}\n`);
    }
    info(`填完后跑: dch profile use <id>`);
  }
}

function printRestorePreview(manifest: Manifest, plan: ApplyBackupResult): void {
  console.log(`${c.bold}${c.blue}DRY-RUN — 不会修改文件${c.reset}\n`);
  console.log(`${c.bold}来源：${c.reset}${manifest.source_user}@${manifest.source_host} · ${manifest.created_at}`);
  console.log(`${c.bold}DCH 版本：${c.reset}${manifest.dch_version}`);
  if (manifest.options.no_placeholder) {
    console.log(`${c.red}⚠ 包内含明文凭据 (--no-placeholder 模式)${c.reset}`);
  }
  console.log();

  console.log(`${c.bold}待还原 profile (${plan.appliedProfiles.length}):${c.reset}`);
  for (const ap of plan.appliedProfiles) {
    const tag = ap.conflict === "none"
      ? `${c.gray}无冲突 ✓${c.reset}`
      : `${c.yellow}${ap.conflict}${c.reset}`;
    console.log(`  ${ap.originalId} → ${c.bold}${ap.finalId}${c.reset} (${ap.configDir}) ${tag}`);
  }

  if (plan.sharedActions.length > 0) {
    console.log(`\n${c.bold}共享资源:${c.reset}`);
    for (const sa of plan.sharedActions) {
      console.log(`  ${sa.category} ${sa.relPath} → ${sa.action}`);
    }
  }

  // 优先 secrets_index 总览（新 pack）；旧 pack fall back 到原 placeholders dump
  if (manifest.secrets_index && manifest.secrets_index.entries.length > 0) {
    const idx = manifest.secrets_index;
    console.log(
      `\n${c.bold}唯一凭据 (去重后): ${idx.total_logical_keys} 个 logical key / ` +
      `${idx.total_occurrences} 处占位符${c.reset}`,
    );
    for (const e of idx.entries) {
      console.log(`  ${c.bold}${e.name}${c.reset} ${c.gray}(count=${e.count}, ${e.hint})${c.reset}`);
    }
    console.log(`\n${c.gray}💡 use --fill-secrets 交互填入 / --secrets-json <file> 自动化${c.reset}`);
  } else if (plan.placeholders.length > 0) {
    console.log(`\n${c.bold}${c.yellow}待填占位符 (${plan.placeholders.length}):${c.reset}`);
    for (const ph of plan.placeholders) {
      console.log(`  ${ph.hostPath ?? ph.packPath} :: ${ph.fieldName} — ${ph.hint}`);
    }
  }

  if (plan.errors.length > 0) {
    console.log(`\n${c.bold}${c.red}错误 (${plan.errors.length}):${c.reset}`);
    for (const e of plan.errors) console.log(`  ${e}`);
  }
}

// ─── backups (list) ──────────────────────────────────────────────────────

export async function cmdBackups(_args: string[]): Promise<void> {
  const items = await listBackups();
  if (isJsonMode()) return jsonOut({ ok: true, backupDir: BACKUP_DIR, items });
  if (items.length === 0) {
    info(`无备份。先跑 ${c.bold}dch profile backup${c.reset} 创建。`);
    info(`备份目录: ${BACKUP_DIR}`);
    return;
  }
  console.log(`${c.bold}${c.blue}Dev Config Hub - Backups${c.reset}`);
  console.log(`${c.gray}${BACKUP_DIR}${c.reset}\n`);

  printGroup("📌 默认位（每次 backup 覆盖）", items.filter((x) => x.category === "default"));
  printGroup("⭐ 置顶（不会被覆盖）", items.filter((x) => x.category === "pinned"));
  printGroup("📜 历史（--keep 创建）", items.filter((x) => x.category === "history"));
}

function printGroup(title: string, items: BackupSummary[]): void {
  if (items.length === 0) return;
  console.log(`${c.bold}${title}${c.reset} ${c.gray}(${items.length})${c.reset}`);
  for (const it of items) {
    const m = it.manifest;
    const summary = m
      ? `profile:${m.profileCount}${m.placeholderCount > 0 ? ` 占位符:${m.placeholderCount}` : ""}${m.noPlaceholder ? ` ${c.red}[明文]${c.reset}` : ""}`
      : `${c.red}manifest 解析失败: ${it.manifestError}${c.reset}`;
    const ts = new Date(it.mtimeMs).toISOString().slice(0, 19).replace("T", " ");
    console.log(`  ${c.bold}${c.white}${it.filename}${c.reset} ${c.gray}${formatBytes(it.bytes)} · ${ts}${c.reset}`);
    console.log(`    ${c.gray}${summary}${c.reset}`);
    if (m && m.profileCount > 0) {
      console.log(`    ${c.gray}profiles: ${m.profileIds.join(", ")}${c.reset}`);
    }
    console.log(`    ${c.gray}${it.path}${c.reset}`);
  }
  console.log();
}

// ─── backup-rm ───────────────────────────────────────────────────────────

export async function cmdBackupRm(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args, { allowedFlags: BACKUP_RM_ALLOWED });
  const [pathArg] = positional;
  if (!pathArg) err("用法: dch profile backup-rm <file> [--yes]");

  if (!flags.yes && !isJsonMode()) {
    process.stdout.write(`${c.yellow}确认删除备份 ${c.bold}${pathArg}${c.reset}${c.yellow}? [y/N] ${c.reset}`);
    const line = await readStdinLine();
    if (line.toLowerCase() !== "y" && line.toLowerCase() !== "yes") {
      info("已取消");
      return;
    }
  }

  await deleteBackup(pathArg);
  if (isJsonMode()) return jsonOut({ ok: true, removed: pathArg });
  ok(`已删除 ${pathArg}`);
}

// ─── backup-pin ──────────────────────────────────────────────────────────

export async function cmdBackupPin(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args, { allowedFlags: BACKUP_PIN_ALLOWED });
  const [pathArg] = positional;
  if (!pathArg) err("用法: dch profile backup-pin <file> [--unpin]");

  const pin = flags.unpin !== true;
  const r = await pinBackup(pathArg, pin);

  if (isJsonMode()) return jsonOut({ ok: true, pin, ...r });
  if (pin) {
    if (r.copiedFromLatest) {
      ok(`已置顶（默认位 → 复制副本 ${r.pinnedPath}）`);
      info(`原 ${DEFAULT_PATH} 仍是默认位，下次 backup 会被覆盖`);
    } else {
      ok(`已置顶 ${r.pinnedPath}`);
    }
  } else {
    ok(`已取消置顶 ${r.pinnedPath}`);
  }
}
