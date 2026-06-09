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
 *
 * **REVIEW_9 G6 拆模块**: 共享 types (FORMAT_VERSION / ManifestProfile /
 * PlaceholderEntry / Manifest) + helpers (tsForFilename / walkFiles / fileExists /
 * spawnSimple) 抽到 `backup-shared.ts`,消除 backup.ts ↔ backup-restore.ts +
 * backup.ts ↔ secrets-index.ts 双向 import。caller 仍 `import { ... } from "./backup.ts"`
 * 不变 — 通过 re-export 透传。
 */

import { mkdir, mkdtemp, rm, copyFile, open } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir, hostname, userInfo } from "node:os";
import type { Profile } from "./types.ts";
import { loadStore, expandHome, collapseHome, HOME, DCH_DIR } from "./store.ts";
import { shouldIncludePath } from "./backup-rules.ts";
import {
  redactByFilename,
  redactProfileEnv,
  type PlaceholderHit,
} from "./redact.ts";
import { buildSecretsIndex, type SecretsIndex } from "./secrets-index.ts";
import {
  FORMAT_VERSION,
  walkFiles, fileExists, tsForFilename, spawnSimple,
  type ManifestProfile, type PlaceholderEntry, type Manifest,
} from "./backup-shared.ts";

// caller 仍 `import { FORMAT_VERSION / Manifest / PlaceholderEntry / ManifestProfile / walkFiles /
// fileExists / tsForFilename / spawnSimple } from "./backup.ts"` 不变 — 通过下面 re-export 透传
// (REVIEW_9 G6 拆 backup-shared.ts)
export {
  FORMAT_VERSION,
  walkFiles, fileExists, tsForFilename, spawnSimple,
} from "./backup-shared.ts";
export type {
  ManifestProfile, PlaceholderEntry, Manifest,
} from "./backup-shared.ts";

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

// ─── createBackup ─────────────────────────────────────────────────────────

export interface CreateBackupOptions {
  outFile?: string;
  profileIds?: string[];
  includeShared?: boolean;
  noPlaceholder?: boolean;
  /**
   * 不带 outFile + keep=false（默认）→ 写默认位 ~/.dch/backups/latest.dchpack（覆盖）。
   * 不带 outFile + keep=true → 写带时间戳的历史文件 ~/.dch/backups/dch-backup-<TS>.dchpack。
   * 显式传 outFile → 一律以 outFile 为准（CLI / UI 显式覆盖）。
   */
  keep?: boolean;
}

export interface CreateBackupResult {
  outFile: string;
  bytes: number;
  manifest: Manifest;
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

async function copyOrRedactFile(
  src: string,
  dst: string,
  filename: string,
  opts: { noPlaceholder: boolean; packPath: string },
  hashByEntry: Map<PlaceholderEntry, string | undefined>,
  warnings: string[],
): Promise<PlaceholderEntry[]> {
  await mkdir(dirname(dst), { recursive: true });
  const file = Bun.file(src);
  const bytes = await file.bytes();

  // REVIEW_8 M2 / Group D5：所有文件都尝试 redact（走 redactByFilename 的内部分发：
  // .json / .toml / sensitive 走 parse-based；其余 fall-through 到 redactPlainTextContent
  // 走 regex 替换）。binary 文件靠 utf-8 fatal decode try-catch 兜底（解码失败 → 原 bytes）。
  if (opts.noPlaceholder) {
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
  // **REVIEW_9 A-HIGH-2 / B-HIGH-2 跨批**: parse 失败 fall back 到 plain-text regex 时
  // redactByFilename 会返 warnings,带上 packPath 让 manifest.security_warnings 显式告知用户
  // 哪个文件走了兜底路径(可能漏脱敏不规范字段)。
  if (r.warnings && r.warnings.length > 0) {
    for (const w of r.warnings) warnings.push(`${opts.packPath}: ${w}`);
  }
  return r.placeholders.map((h) => {
    const entry = entryFromHit(h, opts.packPath);
    hashByEntry.set(entry, h.valueHash);
    return entry;
  });
}

function entryFromHit(h: PlaceholderHit, packPath: string): PlaceholderEntry {
  return { packPath, fieldPath: h.fieldPath, fieldName: h.fieldName, hint: hintFor(h.fieldName) };
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

/** sh single-quote escape：防 spawn ['sh', '-c', cmd] 时含特殊字符的路径被误解析。 */
function shesc(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * **REVIEW_9 follow-up F3**: 原子占位 candidate 文件,杜绝 createBackup --keep 同秒并发
 * TOCTOU(B-LOW-1 / B-codex MED-3 *未验证* 降)。
 *
 * 旧实现 fileExists(candidate) 检查与后续 mv tmpOut→outFile 之间存在窗口:同秒并发 createBackup
 * 进程 A/B 同时 fileExists(`dch-backup-<TS>.dchpack`) 都返 false → 都选同名 candidate →
 * 都跑 tar 写到各自 tmpOut → A mv 完 outFile 存在,B mv 直接覆盖 A → A 的备份丢。
 *
 * 修法:Node fs.open(path, 'wx') flag = O_CREAT|O_EXCL,文件已存在抛 EEXIST。candidate 选定
 * 时立刻 atomic create 0 字节 placeholder 占位,让其他并发进程下次 wx 见到 EEXIST → 走下一
 * 个 suffix。createBackup 主流程后期 mv tmpOut→outFile 走 rename(2) 原子覆盖 placeholder。
 *
 * 失败 path(tar / verify / mv 任一失败) caller 必须 rm placeholder 防 leak 0 字节文件
 * (createBackup 内 try/finally + mvSucceeded flag 实现)。
 *
 * 返 true=占位成功,false=EEXIST 已被占。其他 IO error 透传 throw。
 */
async function tryReserveCandidate(path: string): Promise<boolean> {
  let fh;
  try {
    fh = await open(path, "wx"); // O_CREAT|O_EXCL — 已存在抛 EEXIST
  } catch (e: unknown) {
    if (
      e !== null &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "EEXIST"
    ) {
      return false;
    }
    throw e;
  }
  try {
    return true;
  } finally {
    await fh.close();
  }
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

  // 默认位 vs 历史：见 CreateBackupOptions.keep 注释。outFile 显式传 → 直接用。
  // **REVIEW_9 B-codex M1**: --keep 同秒两次调用旧实现走同名 `dch-backup-<TS>.dchpack` 第二次
  // 直接覆盖第一次。修法:fileExists 循环加 -001 / -002 ... 后缀直到空闲名(与 pinBackup 同款
  // backup-manage.ts:215-225 防撞名);outFile 显式传仍以 caller 为准(CLI / UI 显式覆盖意图明确)。
  //
  // **REVIEW_9 follow-up F3 (落地 B-LOW-1 / B-codex MED-3)**: 改 fileExists 循环为 fs.open
  // wx atomic create-or-fail。原 fileExists check 与后续 mv tmpOut→outFile 之间的 TOCTOU
  // 窗口已闭合 — candidate 选定时立刻原子占位 0 字节 placeholder,并发进程下次 wx 见 EEXIST
  // 自动走下一个 suffix。失败 path 必须 rm placeholder(主 try/finally + mvSucceeded flag)。
  let outFile: string;
  let placeholderToCleanup: string | null = null; // F3: --keep 模式 placeholder cleanup tracker
  if (opts.outFile) {
    outFile = opts.outFile;
    await mkdir(dirname(outFile), { recursive: true });
  } else if (opts.keep) {
    const backupsDir = join(DCH_DIR, "backups");
    await mkdir(backupsDir, { recursive: true }); // tryReserveCandidate 需 parent dir 存在
    const baseTs = tsForFilename();
    let candidate = "";
    let reserved = false;
    for (let suffix = 0; suffix <= 999; suffix++) {
      candidate = suffix === 0
        ? join(backupsDir, `dch-backup-${baseTs}.dchpack`)
        : join(backupsDir, `dch-backup-${baseTs}-${String(suffix).padStart(3, "0")}.dchpack`);
      if (await tryReserveCandidate(candidate)) {
        reserved = true;
        break;
      }
    }
    if (!reserved) {
      throw new Error(`createBackup: 同秒 ${baseTs} 已有 1000 个 .dchpack,无法分配空闲文件名`);
    }
    outFile = candidate;
    placeholderToCleanup = outFile; // 失败 path 必须 rm 这个 0 字节占位
  } else {
    outFile = join(DCH_DIR, "backups", "latest.dchpack");
    await mkdir(dirname(outFile), { recursive: true });
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "dch-backup-"));
  let mvSucceeded = false;
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
    // 与 placeholders 一一对应的 sha256(value).slice(0,16) 短串。`undefined` 表示来自
    // redactWholeFile（整文件场景，每条独立 logical key 不参与 dedup）。仅 backup 内存
    // 阶段用作 group key，分配 logical key 后立即丢弃，绝不写到 manifest / dchpack。
    const hashByEntry = new Map<PlaceholderEntry, string | undefined>();
    // **REVIEW_9 A-HIGH-2 / B-HIGH-2 跨批**: 累加每文件 redactByFilename fallback warnings,
    // 最终拼到 manifest.security_warnings 让用户感知备份内有「parse 失败已走 plain-text 兜底」
    // 的文件,可能漏脱敏不规范字段。
    const fileLevelWarnings: string[] = [];
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
          const entry: PlaceholderEntry = {
            packPath: `profiles/${p.id}/_meta.json`,
            fieldPath: `$.env.${h.fieldName}`,
            fieldName: h.fieldName,
            hint: hintFor(h.fieldName),
          };
          placeholders.push(entry);
          hashByEntry.set(entry, h.valueHash);
        }
      }

      for await (const f of walkFiles(configDirAbs)) {
        if (!shouldIncludePath(f.relPath)) continue;
        const dst = join(configDirOut, f.relPath);
        const filename = basename(f.relPath);
        const hits = await copyOrRedactFile(f.absPath, dst, filename, {
          noPlaceholder,
          packPath: `profiles/${p.id}/configDir/${f.relPath}`,
        }, hashByEntry, fileLevelWarnings);
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

    // 4.5 placeholders → secrets_index：按 (fieldName, valueHash) 全局合并去重。
    //     仅当 entries 非空才挂到 manifest（noPlaceholder 模式 / 实际无敏感命中时 omit，
    //     旧 dch restore 路径走 `manifest.placeholders[]` fall back 完全兼容）。
    const builtIndex = placeholders.length > 0
      ? buildSecretsIndex(placeholders, hashByEntry)
      : undefined;
    const secretsIndex = builtIndex && builtIndex.entries.length > 0 ? builtIndex : undefined;

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
      ...(secretsIndex ? { secrets_index: secretsIndex } : {}),
      security_warnings: [
        ...(noPlaceholder ? ["raw_credentials: 此包包含明文凭据，仅限本地加密迁移"] : []),
        ...fileLevelWarnings,
      ],
    };
    await writeJson(join(tmpDir, "manifest.json"), manifest);
    await Bun.write(join(tmpDir, "README.md"), readmeText(manifest));

    // 6. tar 归档：-h deref symlink + 走 sh pipe 用 gzip -1（fastest）替代默认 level 6。
    //    实测对 ~80MB 配置 + 7000+ 文件的备份：level 6 ≈ 5-10s；level 1 ≈ 2-3s + 包大小仅
    //    增加 ~15%。UI 「导出备份」是 hot path，速度优先于压缩率。
    //    sh single-quote escape 防 outFile / tmpDir 含特殊字符注入。
    //
    // REVIEW_8 H4 / Group D2：原子写。旧实现 `... > $outFile` 直写默认位
    // ~/.dch/backups/latest.dchpack，进程被杀 / OOM / 磁盘满 / Cmd-Q 中断会留半文件，
    // 下次 restore 走 tar -xzf 直接报「unexpected EOF」+ 用户失去最近 backup。
    // 三步原子：写 tmp → tar -tzf 验证 archive 完整 → mv tmp → outFile。
    // mv 同 fs 内 rename(2) 原子，半写时 outFile 仍指向上次成功的 latest.dchpack。
    // 注：H2 落地后 walkFiles 已过滤 symlink，tar -h 仅作为防御性 no-op 保留。
    const tmpOut = `${outFile}.dch-tmp-${process.pid}`;
    const tarRes = await spawnSimple([
      "sh", "-c",
      `tar -chf - -C ${shesc(tmpDir)} . | gzip -1 > ${shesc(tmpOut)}`,
    ]);
    if (!tarRes.ok) {
      try { await rm(tmpOut, { force: true }); } catch {}
      throw new Error(`tar 归档失败: ${tarRes.stderr}`);
    }
    // 验证 tmp 可被 tar 解析（catch tar pipe 失败但 stderr 没 fail / gzip 半写 等罕见 race）
    const verifyRes = await spawnSimple([
      "sh", "-c",
      `tar -tzf ${shesc(tmpOut)} > /dev/null`,
    ]);
    if (!verifyRes.ok) {
      try { await rm(tmpOut, { force: true }); } catch {}
      throw new Error(`tar 验证失败（写出的 archive 不完整）: ${verifyRes.stderr}`);
    }
    // 原子 rename — 同 fs（都在 ~/.dch/backups/）下 mv = rename(2) 原子
    // F3: --keep 模式 outFile 是 tryReserveCandidate 占的 0 字节 placeholder,mv 同 fs rename(2)
    // 原子覆盖。mv 成功 → mvSucceeded=true 让 finally 跳过 placeholder cleanup。
    const mvRes = await spawnSimple(["mv", tmpOut, outFile]);
    if (!mvRes.ok) {
      try { await rm(tmpOut, { force: true }); } catch {}
      throw new Error(`rename 失败: ${mvRes.stderr}`);
    }
    mvSucceeded = true;

    const bytes = (await Bun.file(outFile).stat()).size;
    return { outFile, bytes, manifest };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    // F3: --keep 模式失败 path(tar / verify / mv 任一失败 throw)必须 rm placeholder 防 leak
    // 0 字节占位文件。mv 成功的 happy path 已被覆盖,此处 mvSucceeded=true 跳过 cleanup。
    if (placeholderToCleanup && !mvSucceeded) {
      try { await rm(placeholderToCleanup, { force: true }); } catch {}
    }
  }
}

function readmeText(m: Manifest): string {
  const warn = m.options.no_placeholder
    ? "⚠️ **此备份含明文凭据（--no-placeholder 模式），请通过加密渠道传输。**\n\n"
    : "";
  const profileLines = m.profiles.map((p) => `- \`${p.id}\` (${p.tool}) → \`${p.configDir_original}\``).join("\n");
  const uniqueSection = m.secrets_index ? formatUniqueSecretsSection(m.secrets_index) : "";
  const detailsTitle = m.secrets_index
    ? `## 占位符详细清单（共 ${m.placeholders.length} 处）`
    : "## 待填占位符";
  const phLines = m.placeholders.length
    ? m.placeholders.map((p) => `- \`${p.packPath}\` :: ${p.fieldName} — ${p.hint}`).join("\n")
    : "（无）";
  return `${warn}# Dev Config Hub Backup

- 创建时间：${m.created_at}
- 来源主机：${m.source_host} / ${m.source_user}
- DCH 版本：${m.dch_version}

## 包含 profile

${profileLines}

${uniqueSection}${detailsTitle}

${phLines}

## 还原方式

\`\`\`
dch profile restore <this-file>.dchpack
\`\`\`

或在 UI 中：ProfilePanel → 📥 导入备份。
`;
}

function formatUniqueSecretsSection(idx: SecretsIndex): string {
  const lines = idx.entries
    .map((e) => `- \`${e.name}\` (count=${e.count}) — ${e.hint}`)
    .join("\n");
  return `## 唯一凭据（去重后）

共 ${idx.total_logical_keys} 个 logical key（合并自 ${idx.total_occurrences} 处占位符）。restore 时填一次即按 fieldPath fan-out 到所有 location：

${lines}

`;
}


// ─── re-export 还原侧 API，外部 import 不变 ──────────────────────────────
// cli-profile.ts / bridge.ts 仍可 `import { parseBackup, applyBackup, ApplyBackupResult }
// from "./profiles/backup.ts"` —— 拆 backup-restore.ts 是内部细节，对外保持单入口。
//
// REVIEW_9 G6: 旧版 line 416 `export { tsForFilename, walkFiles, fileExists, spawnSimple }`
// 给 backup-restore.ts 直接 import 这 4 个 helper(双向 import 反向);抽 backup-shared.ts
// 后这 4 个 helper 由 backup-shared.ts 直接 export,backup-restore.ts 直接 import 自
// backup-shared.ts 不再走 backup.ts 间接桥(保留本文件 36-39 行 re-export 给外部 caller 兼容)。
//
// **REVIEW_9 B-LOW-2 / B-claude L1**: applyBackupWithSecrets 直接 re-export 自
// `./backup-restore-secrets.ts` 而不绕 `./backup-restore.ts`。旧版 backup-restore.ts 顶部
// `export { applyBackupWithSecrets } from "./backup-restore-secrets.ts"` 与
// backup-restore-secrets.ts 顶部 `import { applyBackup } from "./backup-restore.ts"` 构成
// 模块循环 import(虽 ESM 能处理 lazy resolve 但耦合不干净 + Bun toolchain 警告)。本 facade
// 拆开 import 源 → backup-restore.ts 不再 import / re-export backup-restore-secrets.ts(单向)。
export {
  parseBackup, cleanupParsed, applyBackup,
  type ParseBackupResult, type ApplyBackupOptions, type ApplyBackupResult,
  type AppliedProfile, type SharedAction, type ConflictAction,
} from "./backup-restore.ts";
export {
  applyBackupWithSecrets,
  type ApplyBackupWithSecretsOptions, type ApplyBackupWithSecretsResult,
} from "./backup-restore-secrets.ts";
