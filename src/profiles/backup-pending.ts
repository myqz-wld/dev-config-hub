import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { buildBackupArchive } from "./backup-create.ts";
import { DCH_DIR } from "./store.ts";
import { tsForFilename, type Manifest } from "./backup-shared.ts";

const PENDING_DIR = join(DCH_DIR, "backups", ".pending");
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[0-9a-f-]{36}$/;

interface PendingMetadata {
  token: string;
  createdAt: string;
  archivePath: string;
  requestedOutFile?: string;
  keep: boolean;
  bytes: number;
  manifest: Manifest;
}

export interface PrepareBackupOptions {
  outFile?: string;
  profileIds?: string[];
  includeScripts?: boolean;
  noPlaceholder?: boolean;
  keep?: boolean;
}

export interface PrepareBackupResult {
  token: string;
  bytes: number;
  manifest: Manifest;
  expiresAt: string;
}

export interface CommitPreparedBackupOptions {
  confirmRawSecrets?: boolean;
}

export interface CommitPreparedBackupResult {
  outFile: string;
  bytes: number;
  manifest: Manifest;
}

function assertToken(token: string): void {
  if (!TOKEN_RE.test(token)) throw new Error("无效的备份预览 token");
}

function metadataPath(token: string): string {
  assertToken(token);
  return join(PENDING_DIR, `${token}.json`);
}

function archivePath(token: string): string {
  assertToken(token);
  return join(PENDING_DIR, `${token}.dchpack`);
}

async function ensurePendingDir(): Promise<void> {
  await mkdir(PENDING_DIR, { recursive: true, mode: 0o700 });
  await chmod(PENDING_DIR, 0o700);
}

async function cleanupExpiredPending(): Promise<void> {
  await ensurePendingDir();
  const now = Date.now();
  for (const entry of await readdir(PENDING_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(PENDING_DIR, entry.name);
    try {
      if (now - (await stat(path)).mtimeMs > MAX_PENDING_AGE_MS) {
        await rm(path, { force: true });
      }
    } catch {}
  }
}

async function readMetadata(token: string): Promise<PendingMetadata> {
  const path = metadataPath(token);
  let metadata: PendingMetadata;
  try {
    metadata = JSON.parse(await readFile(path, "utf8")) as PendingMetadata;
  } catch {
    throw new Error("备份预览不存在或已过期，请重新预览");
  }
  if (metadata.token !== token || metadata.archivePath !== archivePath(token)) {
    throw new Error("备份预览元数据无效");
  }
  if (Date.now() - Date.parse(metadata.createdAt) > MAX_PENDING_AGE_MS) {
    await cancelPreparedBackup(token);
    throw new Error("备份预览已过期，请重新预览");
  }
  return metadata;
}

export async function prepareBackup(
  opts: PrepareBackupOptions = {},
): Promise<PrepareBackupResult> {
  await cleanupExpiredPending();
  const token = randomUUID();
  const pendingArchive = archivePath(token);
  const built = await buildBackupArchive({
    archivePath: pendingArchive,
    profileIds: opts.profileIds,
    includeScripts: opts.includeScripts,
    noPlaceholder: opts.noPlaceholder,
  });
  const metadata: PendingMetadata = {
    token,
    createdAt: new Date().toISOString(),
    archivePath: pendingArchive,
    requestedOutFile: opts.outFile,
    keep: !!opts.keep,
    bytes: built.bytes,
    manifest: built.manifest,
  };
  const metaPath = metadataPath(token);
  await Bun.write(metaPath, JSON.stringify(metadata, null, 2) + "\n");
  await chmod(metaPath, 0o600);
  return {
    token,
    bytes: built.bytes,
    manifest: built.manifest,
    expiresAt: new Date(Date.parse(metadata.createdAt) + MAX_PENDING_AGE_MS).toISOString(),
  };
}

async function reserveHistoryPath(): Promise<string> {
  const backupsDir = join(DCH_DIR, "backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = tsForFilename();
  for (let suffix = 0; suffix <= 999; suffix++) {
    const candidate = join(
      backupsDir,
      suffix === 0
        ? `dch-backup-${timestamp}.dchpack`
        : `dch-backup-${timestamp}-${String(suffix).padStart(3, "0")}.dchpack`,
    );
    try {
      const handle = await open(candidate, "wx", 0o600);
      await handle.close();
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("同一秒已有 1000 个历史备份，无法分配文件名");
}

async function finalPath(metadata: PendingMetadata): Promise<{
  path: string;
  reserved: boolean;
}> {
  if (metadata.requestedOutFile) {
    return { path: metadata.requestedOutFile, reserved: false };
  }
  if (metadata.keep) return { path: await reserveHistoryPath(), reserved: true };
  return { path: join(DCH_DIR, "backups", "latest.dchpack"), reserved: false };
}

export async function commitPreparedBackup(
  token: string,
  opts: CommitPreparedBackupOptions = {},
): Promise<CommitPreparedBackupResult> {
  await cleanupExpiredPending();
  const metadata = await readMetadata(token);
  if (
    metadata.manifest.backup_audit?.contains_raw_secrets &&
    !opts.confirmRawSecrets
  ) {
    throw new Error("此预览包含保留的明文密钥；确认风险后才能写入最终备份");
  }
  const destination = await finalPath(metadata);
  await mkdir(dirname(destination.path), { recursive: true });
  const temp = `${destination.path}.dch-tmp-${process.pid}-${randomUUID()}`;
  let committed = false;
  try {
    await copyFile(metadata.archivePath, temp);
    await chmod(temp, 0o600);
    await rename(temp, destination.path);
    committed = true;
  } finally {
    await rm(temp, { force: true });
    if (!committed && destination.reserved) {
      await rm(destination.path, { force: true });
    }
  }
  await Promise.all([
    rm(metadata.archivePath, { force: true }),
    rm(metadataPath(token), { force: true }),
  ]);
  return {
    outFile: destination.path,
    bytes: metadata.bytes,
    manifest: metadata.manifest,
  };
}

export async function cancelPreparedBackup(token: string): Promise<void> {
  assertToken(token);
  await Promise.all([
    rm(archivePath(token), { force: true }),
    rm(metadataPath(token), { force: true }),
  ]);
}

export function pendingBackupDirectoryForTest(): string {
  return PENDING_DIR;
}
