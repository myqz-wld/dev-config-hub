import { hostname, tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import type { Profile } from "./types.ts";
import {
  DCH_DIR,
  collapseHome,
  expandHome,
  loadStore,
} from "./store.ts";
import {
  resolveProfileBackupPolicy,
  resolveScriptsBackupPolicy,
  scriptsBackupEnabled,
  validateStoreBackupPolicies,
} from "./backup-policy.ts";
import { evaluateFileCoverage } from "./backup-policy-match.ts";
import { transformBackupFile } from "./backup-policy-transform.ts";
import { buildSecretsIndex } from "./secrets-index.ts";
import {
  FORMAT_VERSION,
  spawnSimple,
  walkFiles,
  type BackupAudit,
  type BackupFileAudit,
  type BackupPolicyAudit,
  type Manifest,
  type ManifestProfile,
  type PlaceholderEntry,
} from "./backup-shared.ts";

export interface BuildBackupArchiveOptions {
  archivePath: string;
  profileIds?: string[];
  includeScripts?: boolean;
  noPlaceholder?: boolean;
}

export interface BuildBackupArchiveResult {
  bytes: number;
  manifest: Manifest;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function policyDigest(policy: unknown): string {
  return new Bun.CryptoHasher("sha256")
    .update(canonicalJson(policy))
    .digest("hex");
}

function policyAudit(
  owner: string,
  resolved: ReturnType<typeof resolveProfileBackupPolicy> |
    ReturnType<typeof resolveScriptsBackupPolicy>,
): BackupPolicyAudit {
  return {
    owner,
    source: resolved.source,
    schema_version: 1,
    digest: policyDigest(resolved.policy),
    file_rule_count: resolved.policy.fileRules.filter((rule) => rule.enabled).length,
    secret_rule_count: [
      ...resolved.policy.secretRules.wholeFile,
      ...resolved.policy.secretRules.field,
      ...resolved.policy.secretRules.content,
    ].filter((rule) => rule.enabled).length,
  };
}

function emptyAudit(): BackupAudit {
  return {
    schema_version: 1,
    policies: [],
    totals: {
      included_files: 0,
      excluded_files: 0,
      unscannable_files: 0,
      placeholder_hits: 0,
      excluded_secret_hits: 0,
      retained_secret_hits: 0,
      ignored_hits: 0,
    },
    contains_raw_secrets: false,
    files: [],
  };
}

function aggregateSecretHits(
  hits: Array<{ ruleId: string; action: "placeholder" | "exclude-file" | "keep-original" | "ignore" }>,
): BackupFileAudit["secret_hits"] {
  const counts = new Map<string, BackupFileAudit["secret_hits"][number]>();
  for (const hit of hits) {
    const key = `${hit.ruleId}\0${hit.action}`;
    const current = counts.get(key);
    if (current) current.count++;
    else counts.set(key, { rule_id: hit.ruleId, action: hit.action, count: 1 });
  }
  return [...counts.values()];
}

function recordAudit(
  audit: BackupAudit,
  file: BackupFileAudit,
): void {
  audit.files.push(file);
  if (file.outcome === "included") audit.totals.included_files++;
  else audit.totals.excluded_files++;
  if (file.unscannable) audit.totals.unscannable_files++;
  for (const hit of file.secret_hits) {
    if (hit.action === "exclude-file") {
      audit.totals.excluded_secret_hits += hit.count;
    } else if (file.outcome === "included" && hit.action === "placeholder") {
      audit.totals.placeholder_hits += hit.count;
    } else if (file.outcome === "included" && hit.action === "keep-original") {
      audit.totals.retained_secret_hits += hit.count;
      audit.contains_raw_secrets = true;
    } else if (file.outcome === "included" && hit.action === "ignore") {
      audit.totals.ignored_hits += hit.count;
    }
  }
}

function placeholderEntry(
  hit: { fieldPath: string; fieldName: string },
  packPath: string,
): PlaceholderEntry {
  return {
    packPath,
    fieldPath: hit.fieldPath,
    fieldName: hit.fieldName,
    hint: "敏感字段，请填回真实值",
  };
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, bytes);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeBytes(path, new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n"));
}

async function readDchVersion(): Promise<string> {
  try {
    const pkg = await Bun.file(join(import.meta.dir, "..", "..", "package.json"))
      .json() as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function shesc(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function addPolicyFile(
  args: {
    absPath: string;
    relativePath: string;
    packPath: string;
    outputPath: string;
    owner: string;
    policy: ReturnType<typeof resolveProfileBackupPolicy>["policy"];
    noPlaceholder: boolean;
    audit: BackupAudit;
    placeholders: PlaceholderEntry[];
    hashByEntry: Map<PlaceholderEntry, string | undefined>;
    securityWarnings: string[];
    bypassCoverage?: boolean;
  },
): Promise<boolean> {
  const coverage = args.bypassCoverage
    ? { action: "include" as const, ruleId: null }
    : evaluateFileCoverage(args.policy, args.relativePath);
  if (coverage.action === "exclude") {
    recordAudit(args.audit, {
      owner: args.owner,
      relative_path: args.relativePath,
      pack_path: args.packPath,
      outcome: "excluded",
      coverage_rule_id: coverage.ruleId,
      secret_hits: [],
      unscannable: false,
      warnings: [],
    });
    return false;
  }

  const bytes = await Bun.file(args.absPath).bytes();
  const transformed = transformBackupFile(
    bytes,
    args.relativePath,
    args.policy,
    { noPlaceholder: args.noPlaceholder },
  );
  const secretHits = aggregateSecretHits(transformed.secretHits);
  recordAudit(args.audit, {
    owner: args.owner,
    relative_path: args.relativePath,
    pack_path: args.packPath,
    outcome: transformed.outcome === "include" ? "included" : "excluded",
    coverage_rule_id: coverage.ruleId,
    secret_hits: secretHits,
    unscannable: transformed.unscannable,
    warnings: transformed.warnings,
  });
  for (const warning of transformed.warnings) {
    args.securityWarnings.push(`${args.packPath}: ${warning}`);
  }
  if (transformed.outcome === "exclude") return false;

  await writeBytes(args.outputPath, transformed.content);
  for (const hit of transformed.placeholders) {
    const entry = placeholderEntry(hit, args.packPath);
    args.placeholders.push(entry);
    args.hashByEntry.set(entry, hit.valueHash);
  }
  return true;
}

async function writeProfileMeta(
  profile: Profile,
  outputPath: string,
  packPath: string,
  owner: string,
  policy: ReturnType<typeof resolveProfileBackupPolicy>["policy"],
  noPlaceholder: boolean,
  audit: BackupAudit,
  placeholders: PlaceholderEntry[],
  hashByEntry: Map<PlaceholderEntry, string | undefined>,
  securityWarnings: string[],
): Promise<boolean> {
  const tmp = `${outputPath}.raw-${crypto.randomUUID()}`;
  await writeJson(tmp, profile);
  try {
    return await addPolicyFile({
      absPath: tmp,
      relativePath: "_meta.json",
      packPath,
      outputPath,
      owner,
      policy,
      noPlaceholder,
      audit,
      placeholders,
      hashByEntry,
      securityWarnings,
      bypassCoverage: true,
    });
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function buildBackupArchive(
  opts: BuildBackupArchiveOptions,
): Promise<BuildBackupArchiveResult> {
  const store = await loadStore();
  validateStoreBackupPolicies(store);
  const wanted = opts.profileIds?.length
    ? store.profiles.filter((profile) => opts.profileIds!.includes(profile.id))
    : store.profiles;
  if (wanted.length === 0) {
    throw new Error("没有可备份的 profile（store 为空或 --profiles 过滤无匹配）");
  }
  const missing = opts.profileIds?.filter(
    (id) => !store.profiles.some((profile) => profile.id === id),
  ) ?? [];
  if (missing.length > 0) throw new Error(`未找到待备份方案: ${missing.join(", ")}`);

  const includeScripts = opts.includeScripts !== false && scriptsBackupEnabled(store);
  const noPlaceholder = !!opts.noPlaceholder;
  const workspace = await mkdtemp(join(tmpdir(), "dch-backup-build-"));
  const audit = emptyAudit();
  const placeholders: PlaceholderEntry[] = [];
  const hashByEntry = new Map<PlaceholderEntry, string | undefined>();
  const securityWarnings: string[] = [];
  const manifestProfiles: ManifestProfile[] = [];
  const sharedScripts: string[] = [];

  try {
    for (const profile of wanted) {
      const resolved = resolveProfileBackupPolicy(store, profile);
      const owner = `profile:${profile.id}`;
      audit.policies.push(policyAudit(owner, resolved));
      const profileBase = join(workspace, "profiles", profile.id);
      const metaPath = join(profileBase, "_meta.json");
      const normalizedProfile = {
        ...profile,
        configDir: collapseHome(expandHome(profile.configDir)),
      };
      await writeProfileMeta(
        normalizedProfile,
        metaPath,
        `profiles/${profile.id}/_meta.json`,
        owner,
        resolved.policy,
        noPlaceholder,
        audit,
        placeholders,
        hashByEntry,
        securityWarnings,
      );

      const includedFiles: string[] = [];
      for await (const file of walkFiles(expandHome(profile.configDir))) {
        const packPath = `profiles/${profile.id}/configDir/${file.relPath}`;
        const included = await addPolicyFile({
          absPath: file.absPath,
          relativePath: file.relPath,
          packPath,
          outputPath: join(profileBase, "configDir", file.relPath),
          owner,
          policy: resolved.policy,
          noPlaceholder,
          audit,
          placeholders,
          hashByEntry,
          securityWarnings,
        });
        if (included) includedFiles.push(file.relPath);
      }
      manifestProfiles.push({
        id: profile.id,
        tool: profile.tool,
        configDir_original: collapseHome(expandHome(profile.configDir)),
        description: profile.description,
        hooks: profile.hooks,
        env_keys: Object.keys(profile.env ?? {}),
        active_in_source: store.active[profile.tool] === profile.id,
        files: includedFiles,
      });
    }

    if (includeScripts) {
      const resolved = resolveScriptsBackupPolicy(store);
      const owner = "scripts";
      audit.policies.push(policyAudit(owner, resolved));
      const scriptsRoot = join(DCH_DIR, "scripts");
      for await (const file of walkFiles(scriptsRoot)) {
        const packPath = `dch/scripts/${file.relPath}`;
        const included = await addPolicyFile({
          absPath: file.absPath,
          relativePath: file.relPath,
          packPath,
          outputPath: join(workspace, "dch", "scripts", file.relPath),
          owner,
          policy: resolved.policy,
          noPlaceholder,
          audit,
          placeholders,
          hashByEntry,
          securityWarnings,
        });
        if (included) sharedScripts.push(file.relPath);
      }
    }

    const builtIndex = placeholders.length > 0
      ? buildSecretsIndex(placeholders, hashByEntry)
      : undefined;
    if (audit.contains_raw_secrets) {
      securityWarnings.unshift(
        "raw_credentials: 此包包含规则保留或 --no-placeholder 留下的明文凭据，仅限本地加密迁移",
      );
    }
    const manifest: Manifest = {
      format_version: FORMAT_VERSION,
      created_at: new Date().toISOString(),
      source_host: hostname(),
      source_user: userInfo().username,
      dch_version: await readDchVersion(),
      options: {
        include_scripts: includeScripts,
        no_placeholder: noPlaceholder,
        profile_ids: wanted.map((profile) => profile.id),
      },
      profiles: manifestProfiles,
      shared: { dch_scripts: sharedScripts },
      placeholders,
      ...(builtIndex?.entries.length ? { secrets_index: builtIndex } : {}),
      security_warnings: securityWarnings,
      backup_audit: audit,
    };
    await writeJson(join(workspace, "manifest.json"), manifest);
    await Bun.write(
      join(workspace, "README.md"),
      `# Dev Config Hub Backup\n\n创建时间：${manifest.created_at}\n\n` +
      `包含方案：${manifest.profiles.map((profile) => profile.id).join(", ")}\n\n` +
      `还原：\`dch profile restore <file>.dchpack\`\n`,
    );

    await mkdir(dirname(opts.archivePath), { recursive: true });
    const tempArchive = `${opts.archivePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      const archived = await spawnSimple([
        "sh",
        "-c",
        `tar -chf - -C ${shesc(workspace)} . | gzip -1 > ${shesc(tempArchive)}`,
      ]);
      if (!archived.ok) throw new Error(`tar 归档失败: ${archived.stderr}`);
      const verified = await spawnSimple([
        "sh",
        "-c",
        `tar -tzf ${shesc(tempArchive)} > /dev/null`,
      ]);
      if (!verified.ok) throw new Error(`tar 验证失败: ${verified.stderr}`);
      await chmod(tempArchive, 0o600);
      await rename(tempArchive, opts.archivePath);
    } finally {
      await rm(tempArchive, { force: true });
    }
    return {
      bytes: (await Bun.file(opts.archivePath).stat()).size,
      manifest,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
