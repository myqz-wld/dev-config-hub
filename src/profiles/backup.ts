/**
 * 备份**创建**核心：createBackup（写 .dchpack）+ 共享 helper / 类型。
 *
 * 还原侧（parseBackup / applyBackup / cleanupParsed）见 backup-restore.ts；
 * 本文件末尾 re-export 让外部 `import { ... } from "./backup.ts"` 仍能拿到完整 API。
 *
 * 数据流（创建）：临时目录铺出 manifest + dch/ + profiles/<id>/configDir/ + shared/ → tar -czhf 单文件。
 *
 * 关键设计：
 * - tar -h deref symlink（新机器路径不一致，保留 symlink 无意义）
 * - 配置文件按 INCLUDE/EXCLUDE 双门 walk + 按文件名分发 redact
 * - 占位符 `<<DCH_PLACEHOLDER:KEY_NAME>>` + manifest.placeholders[] 精确路径
 */

import { readdir, mkdir, mkdtemp, rm, copyFile, stat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir, hostname, userInfo } from "node:os";
import type { ToolKind, ProfileHooks, Profile } from "./types.ts";
import { loadStore, expandHome, collapseHome, HOME, DCH_DIR } from "./store.ts";
import { shouldIncludePath, isSensitiveFile } from "./backup-rules.ts";
import {
  redactByFilename,
  redactProfileEnv,
  type PlaceholderHit,
} from "./redact.ts";

export const FORMAT_VERSION = 1 as const;
const PLACEHOLDER_HINTS: Record<string, string> = {
  INTERN_TOKEN: "Gitlab OAuth Token",
  ANTHROPIC_API_KEY: "Anthropic API Key (sk-ant-...)",
  OPENAI_API_KEY: "OpenAI API Key (sk-...)",
  experimental_bearer_token: "Codex bearer token",
  AUTH: "Codex OAuth payload (~/.codex/auth.json)",
  CREDENTIALS: "Claude OAuth payload (~/.claude/credentials.json)",
};

function hintFor(fieldName: string): string {
  return PLACEHOLDER_HINTS[fieldName] ?? "敏感字段，请填回真实值";
}

export interface ManifestProfile {
  id: string;
  tool: ToolKind;
  configDir_original: string;
  description?: string;
  hooks?: ProfileHooks;
  env_keys: string[];
  active_in_source: boolean;
}

export interface PlaceholderEntry {
  /** dchpack 内相对 path（如 `profiles/claude-pro/configDir/.mcp.json`） */
  packPath: string;
  fieldPath: string;
  fieldName: string;
  hint: string;
  /** restore 后实际 host fs 上的绝对路径（dryRun 时根据 final configDir 计算） */
  hostPath?: string;
}

export interface Manifest {
  format_version: typeof FORMAT_VERSION;
  created_at: string;
  source_host: string;
  source_user: string;
  dch_version: string;
  options: {
    include_shared: boolean;
    no_placeholder: boolean;
    profile_ids: string[];
  };
  profiles: ManifestProfile[];
  shared: {
    dch_scripts: string[];
    agents_paths: string[];
  };
  placeholders: PlaceholderEntry[];
  security_warnings: string[];
}

// ─── createBackup ─────────────────────────────────────────────────────────

export interface CreateBackupOptions {
  outFile?: string;
  profileIds?: string[];
  includeShared?: boolean;
  noPlaceholder?: boolean;
}

export interface CreateBackupResult {
  outFile: string;
  bytes: number;
  manifest: Manifest;
}

function tsForFilename(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function readDchVersion(): Promise<string> {
  try {
    const pkgPath = join(import.meta.dir, "..", "..", "package.json");
    const pkg = await Bun.file(pkgPath).json() as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * 递归遍历目录，yield 每个文件的相对 path + 绝对 path。
 * 不跟 symlink 走（symlink 单独由 tar -h deref 时处理；这里 readdir 默认就跟 symlink）。
 * 目录不存在 / 读权限挂掉 → 静默跳过。
 */
async function* walkFiles(
  rootAbs: string,
  relBase = "",
): AsyncGenerator<{ relPath: string; absPath: string }> {
  let entries;
  try {
    entries = await readdir(rootAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = join(rootAbs, e.name);
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory() || (e.isSymbolicLink() && (await isDirSafe(abs)))) {
      yield* walkFiles(abs, rel);
    } else if (e.isFile() || e.isSymbolicLink()) {
      yield { relPath: rel, absPath: abs };
    }
  }
}

async function isDirSafe(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyOrRedactFile(
  src: string,
  dst: string,
  filename: string,
  opts: { noPlaceholder: boolean; packPath: string },
): Promise<PlaceholderEntry[]> {
  await mkdir(dirname(dst), { recursive: true });
  const file = Bun.file(src);
  const bytes = await file.bytes();

  const wantsRedact =
    !opts.noPlaceholder &&
    (filename.endsWith(".json") || filename.endsWith(".toml") || isSensitiveFile(filename));

  if (!wantsRedact) {
    await Bun.write(dst, bytes);
    return [];
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    await Bun.write(dst, bytes);
    return [];
  }
  const r = redactByFilename(text, filename);
  await Bun.write(dst, r.content);
  return r.placeholders.map((h) => entryFromHit(h, opts.packPath));
}

function entryFromHit(h: PlaceholderHit, packPath: string): PlaceholderEntry {
  return { packPath, fieldPath: h.fieldPath, fieldName: h.fieldName, hint: hintFor(h.fieldName) };
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

async function spawnSimple(cmd: string[], cwd?: string): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { ok: code === 0, stderr };
}

export async function createBackup(opts: CreateBackupOptions = {}): Promise<CreateBackupResult> {
  const noPlaceholder = !!opts.noPlaceholder;
  const includeShared = opts.includeShared !== false;
  const store = await loadStore();
  const allProfiles = store.profiles;
  const wanted = opts.profileIds && opts.profileIds.length > 0
    ? allProfiles.filter((p) => opts.profileIds!.includes(p.id))
    : allProfiles;

  if (wanted.length === 0) throw new Error("没有可备份的 profile（store 为空或 --profiles 过滤无匹配）");

  const outFile = opts.outFile ?? join(DCH_DIR, "backups", `dch-backup-${tsForFilename()}.dchpack`);
  await mkdir(dirname(outFile), { recursive: true });

  const tmpDir = await mkdtemp(join(tmpdir(), "dch-backup-"));
  try {
    // 1. 写 dch/profiles.json（脱敏整体），带 profiles[i].env 已脱敏
    const dchProfiles = {
      ...store,
      profiles: wanted.map((p) => {
        if (noPlaceholder) return p;
        const { env } = redactProfileEnv(p.env);
        return { ...p, env: Object.keys(env).length ? env : undefined };
      }),
    };
    await writeJson(join(tmpDir, "dch", "profiles.json"), dchProfiles);

    // 2. 写 dch/ui-prefs.json（如果存在）— ui-prefs 不含敏感
    const uiPrefsPath = join(DCH_DIR, "ui-prefs.json");
    if (await fileExists(uiPrefsPath)) {
      await mkdir(join(tmpDir, "dch"), { recursive: true });
      await copyFile(uiPrefsPath, join(tmpDir, "dch", "ui-prefs.json"));
    }

    // 3. shared 资源：~/.dch/scripts/* + ~/.agents/**
    const sharedScripts: string[] = [];
    const agentsPaths: string[] = [];
    if (includeShared) {
      const scriptsDir = join(DCH_DIR, "scripts");
      for await (const f of walkFiles(scriptsDir)) {
        await mkdir(dirname(join(tmpDir, "dch", "scripts", f.relPath)), { recursive: true });
        await copyFile(f.absPath, join(tmpDir, "dch", "scripts", f.relPath));
        sharedScripts.push(f.relPath);
      }
      const agentsDir = join(HOME, ".agents");
      for await (const f of walkFiles(agentsDir)) {
        if (f.relPath === ".skill-lock.json") continue;
        await mkdir(dirname(join(tmpDir, "shared", "agents", f.relPath)), { recursive: true });
        await copyFile(f.absPath, join(tmpDir, "shared", "agents", f.relPath));
        agentsPaths.push(f.relPath);
      }
    }

    // 4. profiles/<id>/_meta.json + configDir/**
    const placeholders: PlaceholderEntry[] = [];
    const manifestProfiles: ManifestProfile[] = [];
    for (const p of wanted) {
      const profileBase = join(tmpDir, "profiles", p.id);
      const configDirOut = join(profileBase, "configDir");
      const configDirAbs = expandHome(p.configDir);

      const envForMeta = noPlaceholder ? p.env : redactProfileEnv(p.env).env;
      const meta: Profile = {
        ...p,
        configDir: collapseHome(configDirAbs),
        env: envForMeta && Object.keys(envForMeta).length ? envForMeta : undefined,
      };
      await writeJson(join(profileBase, "_meta.json"), meta);

      // env 脱敏命中也算 placeholder
      if (!noPlaceholder) {
        const r = redactProfileEnv(p.env);
        for (const h of r.placeholders) {
          placeholders.push({
            packPath: `profiles/${p.id}/_meta.json`,
            fieldPath: `$.env.${h.fieldName}`,
            fieldName: h.fieldName,
            hint: hintFor(h.fieldName),
          });
        }
      }

      for await (const f of walkFiles(configDirAbs)) {
        if (!shouldIncludePath(f.relPath)) continue;
        const dst = join(configDirOut, f.relPath);
        const filename = basename(f.relPath);
        const hits = await copyOrRedactFile(f.absPath, dst, filename, {
          noPlaceholder,
          packPath: `profiles/${p.id}/configDir/${f.relPath}`,
        });
        placeholders.push(...hits);
      }

      manifestProfiles.push({
        id: p.id,
        tool: p.tool,
        configDir_original: collapseHome(configDirAbs),
        description: p.description,
        hooks: p.hooks,
        env_keys: Object.keys(p.env ?? {}),
        active_in_source: store.active[p.tool] === p.id,
      });
    }

    // 5. manifest + README
    const manifest: Manifest = {
      format_version: FORMAT_VERSION,
      created_at: new Date().toISOString(),
      source_host: hostname(),
      source_user: userInfo().username,
      dch_version: await readDchVersion(),
      options: {
        include_shared: includeShared,
        no_placeholder: noPlaceholder,
        profile_ids: wanted.map((p) => p.id),
      },
      profiles: manifestProfiles,
      shared: { dch_scripts: sharedScripts, agents_paths: agentsPaths },
      placeholders,
      security_warnings: noPlaceholder ? ["raw_credentials: 此包包含明文凭据，仅限本地加密迁移"] : [],
    };
    await writeJson(join(tmpDir, "manifest.json"), manifest);
    await Bun.write(join(tmpDir, "README.md"), readmeText(manifest));

    // 6. tar -czhf 归档（-h deref symlink，避免新机器路径不一致）
    const r = await spawnSimple(["tar", "-czhf", outFile, "-C", tmpDir, "."]);
    if (!r.ok) throw new Error(`tar 归档失败: ${r.stderr}`);

    const bytes = (await Bun.file(outFile).stat()).size;
    return { outFile, bytes, manifest };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function readmeText(m: Manifest): string {
  const warn = m.options.no_placeholder
    ? "⚠️ **此备份含明文凭据（--no-placeholder 模式），请通过加密渠道传输。**\n\n"
    : "";
  const profileLines = m.profiles.map((p) => `- \`${p.id}\` (${p.tool}) → \`${p.configDir_original}\``).join("\n");
  const phLines = m.placeholders.length
    ? m.placeholders.map((p) => `- \`${p.packPath}\` :: ${p.fieldName} — ${p.hint}`).join("\n")
    : "（无）";
  return `${warn}# Dev Config Hub Backup

- 创建时间：${m.created_at}
- 来源主机：${m.source_host} / ${m.source_user}
- DCH 版本：${m.dch_version}

## 包含 profile

${profileLines}

## 待填占位符

${phLines}

## 还原方式

\`\`\`
dch profile restore <this-file>.dchpack
\`\`\`

或在 UI 中：ProfilePanel → 📥 导入备份。
`;
}


// ─── 给 backup-restore.ts 用：export helper（不暴露给外部 caller）─────────
// 把 internal helper 转成 module-level export 让分文件协作。命名空间（前缀 _internal）
// 让阅读者一眼看出这不是稳定 public API（外部 caller 应该走 createBackup / parseBackup /
// applyBackup 等）。

export { tsForFilename, walkFiles, fileExists, isDirSafe, spawnSimple };

// ─── re-export 还原侧 API，外部 import 不变 ──────────────────────────────
// cli-profile.ts / bridge.ts 仍可 `import { parseBackup, applyBackup, ApplyBackupResult }
// from "./profiles/backup.ts"` —— 拆 backup-restore.ts 是内部细节，对外保持单入口。

export {
  parseBackup, cleanupParsed, applyBackup,
  type ParseBackupResult, type ApplyBackupOptions, type ApplyBackupResult,
  type AppliedProfile, type SharedAction, type ConflictAction,
} from "./backup-restore.ts";
