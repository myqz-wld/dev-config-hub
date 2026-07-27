import { c } from "./cli-colors.ts";
import {
  err,
  formatBytes,
  info,
  isJsonMode,
  jsonOut,
  ok,
  parseFlags,
  readStdinLine,
} from "./cli-shared.ts";
import {
  cancelPreparedBackup,
  commitPreparedBackup,
  prepareBackup,
} from "./profiles/backup.ts";

const BACKUP_ALLOWED = new Set([
  "out", "profiles", "no-scripts", "no-shared", "no-placeholder", "yes", "keep",
]);
const BACKUP_COMMIT_ALLOWED = new Set(["yes"]);

function shouldIncludeScripts(flags: Record<string, string | boolean>): boolean {
  return flags["no-scripts"] !== true && flags["no-shared"] !== true;
}

export async function cmdBackup(args: string[]): Promise<void> {
  const { flags } = parseFlags(args, { allowedFlags: BACKUP_ALLOWED });
  const noPlaceholder = flags["no-placeholder"] === true;
  const yes = flags.yes === true;
  let rawSecretsConfirmed = yes;
  const keep = flags.keep === true;
  const profileIds = typeof flags.profiles === "string"
    ? flags.profiles.split(",").map((item) => item.trim()).filter(Boolean)
    : undefined;
  const outFile = typeof flags.out === "string" ? flags.out : undefined;

  if (noPlaceholder && !yes) {
    if (isJsonMode()) {
      err("--no-placeholder 在 --json 模式下必须配 --yes（避免脚本误用泄露明文凭据）");
    }
    process.stdout.write(`${c.yellow}⚠ --no-placeholder：仅将“替换为占位符”改为保留原值，备份可能含明文凭据${c.reset}\n`);
    process.stdout.write(`${c.yellow}  请确认你只在加密渠道（gpg / age / 本地）使用此包。继续? [y/N] ${c.reset}`);
    const line = await readStdinLine();
    if (line.toLowerCase() !== "y" && line.toLowerCase() !== "yes") {
      info("已取消");
      return;
    }
    rawSecretsConfirmed = true;
  }

  const prepared = await prepareBackup({
    outFile,
    profileIds,
    includeScripts: shouldIncludeScripts(flags),
    noPlaceholder,
    keep,
  });
  let committed = false;
  try {
    if (prepared.manifest.backup_audit?.contains_raw_secrets && !rawSecretsConfirmed) {
      if (isJsonMode()) {
        await cancelPreparedBackup(prepared.token).catch(() => {});
        err("有效备份规则会保留明文密钥；--json 模式必须配 --yes");
      }
      process.stdout.write(`${c.red}⚠ 当前规则会在备份中保留明文密钥。继续? [y/N] ${c.reset}`);
      const line = await readStdinLine();
      if (line.toLowerCase() !== "y" && line.toLowerCase() !== "yes") {
        info("已取消");
        return;
      }
      rawSecretsConfirmed = true;
    }
    const result = await commitPreparedBackup(prepared.token, {
      confirmRawSecrets: rawSecretsConfirmed,
    });
    committed = true;

    if (isJsonMode()) return jsonOut({ ok: true, ...result });
    const slot = !outFile && !keep
      ? `${c.gray}（默认位，已覆盖）${c.reset}`
      : !outFile && keep
      ? `${c.gray}（历史副本，已保留）${c.reset}`
      : "";
    ok(`已写入 ${result.outFile} (${formatBytes(result.bytes)}) ${slot}`);
    info(`包含 ${result.manifest.profiles.length} 个 profile: ${result.manifest.profiles.map((profile) => profile.id).join(", ")}`);
    if (result.manifest.shared.dch_scripts.length) {
      info(`切换脚本: ${result.manifest.shared.dch_scripts.length} 个文件`);
    }
    if (result.manifest.placeholders.length > 0) {
      process.stdout.write(`${c.yellow}⚠ 已脱敏 ${result.manifest.placeholders.length} 处凭据${c.reset}\n`);
    }
    if (result.manifest.backup_audit?.contains_raw_secrets) {
      process.stdout.write(`${c.red}⚠ 包内含规则保留的明文凭据，请只通过加密渠道分享${c.reset}\n`);
    }
    info(`还原方式: dch profile restore ${result.outFile}`);
    if (!outFile && !keep) info("列出所有备份: dch profile backups");
  } finally {
    if (!committed) await cancelPreparedBackup(prepared.token).catch(() => {});
  }
}

/** UI preview entry: create the immutable pending archive but do not publish it. */
export async function cmdBackupPrepare(args: string[]): Promise<void> {
  const { flags } = parseFlags(args, { allowedFlags: BACKUP_ALLOWED });
  const result = await prepareBackup({
    outFile: typeof flags.out === "string" ? flags.out : undefined,
    profileIds: typeof flags.profiles === "string"
      ? flags.profiles.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined,
    includeScripts: shouldIncludeScripts(flags),
    noPlaceholder: flags["no-placeholder"] === true,
    keep: flags.keep === true,
  });
  await jsonOut({ ok: true, ...result });
}

export async function cmdBackupCommit(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args, { allowedFlags: BACKUP_COMMIT_ALLOWED });
  const [token] = positional;
  if (!token) err("用法: dch profile backup-commit <token> [--yes]");
  const result = await commitPreparedBackup(token, {
    confirmRawSecrets: flags.yes === true,
  });
  if (isJsonMode()) return jsonOut({ ok: true, ...result });
  ok(`已写入 ${result.outFile} (${formatBytes(result.bytes)})`);
}

export async function cmdBackupCancel(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const [token] = positional;
  if (!token) err("用法: dch profile backup-cancel <token>");
  await cancelPreparedBackup(token);
  if (isJsonMode()) return jsonOut({ ok: true, cancelled: token });
  ok("已取消备份预览");
}
