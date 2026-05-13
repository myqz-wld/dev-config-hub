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
  parseFlags, readStdinLine, formatBytes,
} from "./cli-shared.ts";
import {
  createBackup, parseBackup, applyBackup, cleanupParsed,
  type Manifest, type ApplyBackupResult,
} from "./profiles/backup.ts";
import {
  listBackups, deleteBackup, pinBackup,
  DEFAULT_PATH, BACKUP_DIR,
  type BackupSummary,
} from "./profiles/backup-manage.ts";

// ─── backup ──────────────────────────────────────────────────────────────

export async function cmdBackup(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
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
  const { positional, flags } = parseFlags(args);
  const [packFile] = positional;
  if (!packFile) {
    err("用法: dch profile restore <pack> [--prefix <p>] [--rename OLD=NEW,...] [--dry-run] [--yes]");
  }

  const dryRun = flags["dry-run"] === true;
  const prefix = typeof flags.prefix === "string" ? flags.prefix : undefined;
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
    const dryPlan = await applyBackup({ parsed, prefix, renameMap, dryRun: true });

    if (dryRun) {
      if (isJsonMode()) return jsonOut({ ok: true, dryRun: true, manifest: parsed.manifest, plan: dryPlan });
      printRestorePreview(parsed.manifest, dryPlan);
      return;
    }

    const result = await applyBackup({ parsed, prefix, renameMap });
    if (isJsonMode()) return jsonOut({ ok: result.errors.length === 0, manifest: parsed.manifest, ...result });

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
    if (result.placeholders.length > 0) {
      process.stdout.write(`${c.yellow}待填占位符 ${result.placeholders.length} 处:${c.reset}\n`);
      for (const ph of result.placeholders) {
        process.stdout.write(`  ${ph.hostPath ?? ph.packPath} :: ${ph.fieldName} — ${ph.hint}\n`);
      }
      info(`填完后跑: dch profile use <id>`);
    }
  } finally {
    await cleanupParsed(parsed);
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

  if (plan.placeholders.length > 0) {
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
  const { positional, flags } = parseFlags(args);
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
  const { positional, flags } = parseFlags(args);
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
